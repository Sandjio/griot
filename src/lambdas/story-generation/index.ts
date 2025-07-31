import { EventBridgeEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import AWSXRay from "aws-xray-sdk-core";
import {
  StoryGenerationEventDetail,
  BatchWorkflowEventDetail,
} from "../../types/event-schemas";
import {
  StoryAccess,
  GenerationRequestAccess,
  UserPreferencesAccess,
} from "../../database/access-patterns";
import { EventPublishingHelpers } from "../../utils/event-publisher";
import { createMangaStorageService } from "../../storage/manga-storage";
import { BedrockClient } from "./bedrock-client";
import { StoryContent } from "../../storage/manga-storage";
import {
  withErrorHandling,
  CorrelationContext,
  ErrorLogger,
} from "../../utils/error-handler";
import {
  BusinessMetrics,
  ExternalAPIMetrics,
  PerformanceTimer,
  METRIC_NAMESPACES,
} from "../../utils/cloudwatch-metrics";
import { UserPreferencesData, QlooInsights } from "../../types/data-models";

// Enable X-Ray tracing for AWS SDK
// Note: AWS SDK v3 doesn't require explicit capturing for X-Ray

/**
 * Story Generation Lambda Function
 *
 * Handles story generation events from EventBridge, integrates with Amazon Bedrock
 * for story content generation, saves generated story as Markdown file to S3,
 * stores story metadata in DynamoDB, and publishes events for episode generation.
 *
 * Now supports batch workflow processing for sequential story generation.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6A.2, 6A.3, 6A.4, 6A.6
 */

interface StoryGenerationEvent
  extends EventBridgeEvent<
    "Story Generation Requested",
    StoryGenerationEventDetail
  > {}

interface BatchWorkflowEvent
  extends EventBridgeEvent<
    "Batch Story Generation Requested",
    BatchWorkflowEventDetail
  > {}

type SupportedEvent = StoryGenerationEvent | BatchWorkflowEvent;

const storyGenerationHandler = async (
  event: SupportedEvent,
  correlationId: string
): Promise<void> => {
  // Start X-Ray subsegment for this operation
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment("StoryGeneration");

  // Start performance timer
  const operationTimer = new PerformanceTimer("StoryGeneration");

  // Determine event type and extract common fields
  const isBatchWorkflow =
    event["detail-type"] === "Batch Story Generation Requested";
  const eventType = isBatchWorkflow ? "BatchWorkflow" : "Regular";

  ErrorLogger.logInfo(
    "Story Generation Lambda invoked",
    {
      source: event.source,
      detailType: event["detail-type"],
      eventType,
      userId: event.detail.userId,
      requestId: event.detail.requestId,
      correlationId,
      traceId: segment?.trace_id,
      ...(isBatchWorkflow && {
        workflowId: (event.detail as BatchWorkflowEventDetail).workflowId,
        currentBatch: (event.detail as BatchWorkflowEventDetail).currentBatch,
        totalBatches: (event.detail as BatchWorkflowEventDetail).totalBatches,
        numberOfStories: (event.detail as BatchWorkflowEventDetail)
          .numberOfStories,
      }),
    },
    "StoryGeneration"
  );

  const { userId, requestId } = event.detail;
  let { preferences, insights } = event.detail;

  // Input validation
  if (!userId || userId.trim() === "") {
    const error = new Error("User ID is required and cannot be empty");
    subsegment?.addError(error);
    subsegment?.close();
    throw error;
  }

  // For batch workflow events, query user preferences if not provided
  if (isBatchWorkflow && (!preferences || !insights)) {
    ErrorLogger.logInfo("Querying user preferences for batch workflow", {
      userId,
      requestId,
      hasPreferences: !!preferences,
      hasInsights: !!insights,
    });

    try {
      const preferencesTimer = new PerformanceTimer(
        "DynamoDB-QueryPreferences"
      );
      const userPreferencesData =
        await UserPreferencesAccess.getLatestWithMetadata(userId);
      const prefDuration = preferencesTimer.stop();

      if (!userPreferencesData.preferences) {
        const error = new Error(
          `No user preferences found for user ${userId}. User must submit preferences before starting batch workflow.`
        );
        subsegment?.addError(error);
        subsegment?.close();
        throw error;
      }

      preferences = userPreferencesData.preferences;
      insights = userPreferencesData.insights || {
        recommendations: [],
        trends: [],
      };

      ErrorLogger.logInfo("Successfully retrieved user preferences", {
        userId,
        requestId,
        lastUpdated: userPreferencesData.lastUpdated,
        duration: prefDuration,
      });
    } catch (prefError) {
      ErrorLogger.logError(
        prefError instanceof Error ? prefError : new Error(String(prefError)),
        {
          userId,
          requestId,
          operation: "QueryUserPreferences",
        },
        "StoryGeneration"
      );

      subsegment?.addError(
        prefError instanceof Error ? prefError : new Error(String(prefError))
      );
      subsegment?.close();
      throw prefError;
    }
  }

  // Validate that we now have preferences and insights
  if (!preferences) {
    const error = new Error("User preferences are required");
    subsegment?.addError(error);
    subsegment?.close();
    throw error;
  }

  if (!insights) {
    const error = new Error("User insights are required");
    subsegment?.addError(error);
    subsegment?.close();
    throw error;
  }

  const storyId = uuidv4();
  const timestamp = new Date().toISOString();

  // Add context to X-Ray
  subsegment?.addAnnotation("userId", userId);
  subsegment?.addAnnotation("requestId", requestId);
  subsegment?.addAnnotation("storyId", storyId);
  subsegment?.addAnnotation("eventType", eventType);
  subsegment?.addMetadata("preferences", {
    genres: preferences.genres,
    themes: preferences.themes,
    artStyle: preferences.artStyle,
    targetAudience: preferences.targetAudience,
    contentRating: preferences.contentRating,
  });

  if (isBatchWorkflow) {
    const batchDetail = event.detail as BatchWorkflowEventDetail;
    subsegment?.addAnnotation("workflowId", batchDetail.workflowId);
    subsegment?.addAnnotation("currentBatch", batchDetail.currentBatch);
    subsegment?.addAnnotation("totalBatches", batchDetail.totalBatches);
  }

  try {
    // Update generation request status to processing
    const dbTimer = new PerformanceTimer("DynamoDB-UpdateStatus");
    await GenerationRequestAccess.updateStatus(
      userId,
      requestId,
      "PROCESSING",
      {
        relatedEntityId: storyId,
        ...(isBatchWorkflow && {
          workflowId: (event.detail as BatchWorkflowEventDetail).workflowId,
          currentBatch: (event.detail as BatchWorkflowEventDetail).currentBatch,
        }),
      }
    );
    const dbDuration = dbTimer.stop();

    ErrorLogger.logInfo("Starting story generation", {
      userId,
      requestId,
      storyId,
      eventType,
      preferences: {
        genres: preferences.genres,
        themes: preferences.themes,
        artStyle: preferences.artStyle,
        targetAudience: preferences.targetAudience,
        contentRating: preferences.contentRating,
      },
    });

    // Generate the story using the core story generation logic
    const storyResult = await generateSingleStory(
      userId,
      requestId,
      storyId,
      preferences,
      insights,
      timestamp,
      subsegment
    );

    // Handle batch workflow completion tracking
    if (isBatchWorkflow) {
      await handleBatchWorkflowCompletion(
        event.detail as BatchWorkflowEventDetail,
        storyResult,
        preferences,
        insights
      );
    }

    // Record successful completion metrics
    const totalDuration = operationTimer.stop();
    await BusinessMetrics.recordStoryGenerationSuccess(userId, totalDuration);

    // Add success annotations to X-Ray
    subsegment?.addAnnotation("success", true);
    subsegment?.addAnnotation("storyTitle", storyResult.title);
    subsegment?.addMetadata("performance", {
      totalDuration,
    });
    subsegment?.close();

    ErrorLogger.logInfo("Story generation completed successfully", {
      userId,
      requestId,
      storyId,
      title: storyResult.title,
      eventType,
      totalDuration,
    });
  } catch (error) {
    const totalDuration = operationTimer.stop();

    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        userId,
        requestId,
        storyId,
        eventType,
        totalDuration,
        operation: "StoryGeneration",
      },
      "StoryGeneration"
    );

    // Record failure metrics
    const errorType =
      error instanceof Error ? error.constructor.name : "UNKNOWN_ERROR";
    await BusinessMetrics.recordStoryGenerationFailure(userId, errorType);

    // Handle batch workflow error continuation
    if (isBatchWorkflow) {
      await handleBatchWorkflowError(
        event.detail as BatchWorkflowEventDetail,
        error,
        preferences,
        insights
      );
    }

    try {
      // Update story status to failed if it was created
      const existingStory = await StoryAccess.get(userId, storyId);
      if (existingStory) {
        await StoryAccess.updateStatus(userId, storyId, "FAILED", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }

      // Update generation request status to failed
      await GenerationRequestAccess.updateStatus(userId, requestId, "FAILED", {
        errorMessage: error instanceof Error ? error.message : String(error),
        relatedEntityId: storyId,
        ...(isBatchWorkflow && {
          workflowId: (event.detail as BatchWorkflowEventDetail).workflowId,
          currentBatch: (event.detail as BatchWorkflowEventDetail).currentBatch,
        }),
      });

      // Publish status update event
      await EventPublishingHelpers.publishStatusUpdate(
        userId,
        requestId,
        "STORY",
        "FAILED",
        storyId,
        error instanceof Error ? error.message : String(error)
      );
    } catch (cleanupError) {
      ErrorLogger.logError(
        cleanupError instanceof Error
          ? cleanupError
          : new Error(String(cleanupError)),
        {
          userId,
          requestId,
          storyId,
          operation: "StoryGeneration-Cleanup",
        },
        "StoryGeneration"
      );
    }

    // Add error to X-Ray
    subsegment?.addError(
      error instanceof Error ? error : new Error(String(error))
    );
    subsegment?.addAnnotation("success", false);
    subsegment?.addMetadata("error", {
      message: error instanceof Error ? error.message : String(error),
      type: errorType,
      totalDuration,
    });
    subsegment?.close();

    // For batch workflows, don't re-throw individual story failures
    // The batch should continue with the next story
    if (!isBatchWorkflow) {
      throw error;
    }
  }
};

/**
 * Core story generation logic extracted for reuse
 */
async function generateSingleStory(
  userId: string,
  requestId: string,
  storyId: string,
  preferences: UserPreferencesData,
  insights: QlooInsights,
  timestamp: string,
  subsegment?: any
): Promise<{ title: string; s3Key: string }> {
  // Initialize Bedrock client for story generation
  const bedrockClient = new BedrockClient();

  // Generate story content using Bedrock with timing and tracing
  const bedrockSubsegment = subsegment?.addNewSubsegment("BedrockAPI");
  const bedrockTimer = new PerformanceTimer("BedrockAPI-StoryGeneration");

  let storyResponse;
  try {
    storyResponse = await bedrockClient.generateStory(preferences, insights);

    const bedrockDuration = bedrockTimer.stop();
    const tokensUsed =
      (storyResponse.usage?.inputTokens || 0) +
      (storyResponse.usage?.outputTokens || 0);

    bedrockSubsegment?.addAnnotation("success", true);
    bedrockSubsegment?.addAnnotation("tokensUsed", tokensUsed);
    bedrockSubsegment?.addMetadata("response", {
      contentLength: storyResponse.content.length,
      tokensUsed,
      duration: bedrockDuration,
    });
    bedrockSubsegment?.close();

    // Record Bedrock API metrics
    await ExternalAPIMetrics.recordBedrockAPICall(
      "claude-3-sonnet",
      bedrockDuration
    );
    await ExternalAPIMetrics.recordBedrockAPISuccess("claude-3-sonnet");

    ErrorLogger.logInfo("Successfully generated story content", {
      userId,
      requestId,
      storyId,
      contentLength: storyResponse.content.length,
      tokensUsed,
      duration: bedrockDuration,
    });
  } catch (bedrockError) {
    const bedrockDuration = bedrockTimer.stop();

    bedrockSubsegment?.addError(
      bedrockError instanceof Error
        ? bedrockError
        : new Error(String(bedrockError))
    );
    bedrockSubsegment?.addAnnotation("success", false);
    bedrockSubsegment?.close();

    // Record Bedrock API failure metrics
    await ExternalAPIMetrics.recordBedrockAPIFailure(
      "claude-3-sonnet",
      "GENERATION_ERROR"
    );

    throw bedrockError;
  }

  // Parse the generated story content to extract title and content
  const { title, content } = parseStoryContent(storyResponse.content);

  // Create story content object
  const storyContent: StoryContent = {
    title,
    content,
    metadata: {
      storyId,
      userId,
      requestId,
      preferences: JSON.stringify(preferences),
      generatedAt: timestamp,
      tokensUsed: String(
        (storyResponse.usage?.inputTokens || 0) +
          (storyResponse.usage?.outputTokens || 0)
      ),
    },
  };

  // Initialize storage service
  const storageService = createMangaStorageService();

  // Save story to S3 as Markdown file with timing
  const s3Timer = new PerformanceTimer("S3-SaveStory");
  const s3Reference = await storageService.saveStory(
    userId,
    storyId,
    storyContent
  );
  const s3Duration = s3Timer.stop();

  ErrorLogger.logInfo("Successfully saved story to S3", {
    userId,
    requestId,
    storyId,
    s3Key: s3Reference.key,
    bucket: s3Reference.bucket,
    duration: s3Duration,
  });

  // Store story metadata in DynamoDB with timing
  const storeTimer = new PerformanceTimer("DynamoDB-CreateStory");
  await StoryAccess.create({
    storyId,
    userId,
    title,
    s3Key: s3Reference.key,
    status: "COMPLETED",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const storeDuration = storeTimer.stop();

  ErrorLogger.logInfo("Successfully stored story metadata in DynamoDB", {
    userId,
    requestId,
    storyId,
    duration: storeDuration,
  });

  // Update generation request status to completed
  await GenerationRequestAccess.updateStatus(userId, requestId, "COMPLETED", {
    relatedEntityId: storyId,
  });

  // Publish episode generation event with timing
  const eventTimer = new PerformanceTimer("EventBridge-PublishEpisode");
  await EventPublishingHelpers.publishEpisodeGeneration(
    userId,
    storyId,
    s3Reference.key,
    1 // Start with episode 1
  );
  const eventDuration = eventTimer.stop();

  ErrorLogger.logInfo("Successfully published episode generation event", {
    userId,
    requestId,
    storyId,
    episodeNumber: 1,
    duration: eventDuration,
  });

  // Publish status update event
  await EventPublishingHelpers.publishStatusUpdate(
    userId,
    requestId,
    "STORY",
    "COMPLETED",
    storyId
  );

  return { title, s3Key: s3Reference.key };
}

/**
 * Handle batch workflow completion tracking and next story triggering
 */
async function handleBatchWorkflowCompletion(
  batchDetail: BatchWorkflowEventDetail,
  storyResult: { title: string; s3Key: string },
  preferences: UserPreferencesData,
  insights: QlooInsights
): Promise<void> {
  const {
    userId,
    workflowId,
    requestId,
    numberOfStories,
    currentBatch,
    totalBatches,
  } = batchDetail;

  ErrorLogger.logInfo("Processing batch workflow completion", {
    userId,
    workflowId,
    requestId,
    currentBatch,
    totalBatches,
    numberOfStories,
    storyTitle: storyResult.title,
  });

  // Check if this is the last story in the batch
  if (currentBatch >= totalBatches) {
    ErrorLogger.logInfo("Batch workflow completed - all stories generated", {
      userId,
      workflowId,
      requestId,
      totalStories: numberOfStories,
    });

    // Publish batch workflow completion event
    await EventPublishingHelpers.publishStatusUpdate(
      userId,
      requestId,
      "STORY",
      "COMPLETED",
      workflowId,
      `Batch workflow completed: ${numberOfStories} stories generated`
    );

    return;
  }

  // Trigger next story generation in the batch
  const nextBatch = currentBatch + 1;
  const nextRequestId = `${requestId}-batch-${nextBatch}`;

  ErrorLogger.logInfo("Triggering next story in batch workflow", {
    userId,
    workflowId,
    currentBatch,
    nextBatch,
    totalBatches,
    nextRequestId,
  });

  try {
    // Create generation request for next story
    await GenerationRequestAccess.create({
      userId,
      requestId: nextRequestId,
      type: "STORY",
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Publish next batch story generation event
    await EventPublishingHelpers.publishBatchStoryGeneration(
      userId,
      workflowId,
      nextRequestId,
      numberOfStories,
      nextBatch,
      totalBatches,
      preferences,
      insights
    );

    ErrorLogger.logInfo("Successfully triggered next story in batch", {
      userId,
      workflowId,
      nextBatch,
      nextRequestId,
    });
  } catch (error) {
    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        userId,
        workflowId,
        currentBatch,
        nextBatch,
        operation: "TriggerNextBatchStory",
      },
      "StoryGeneration"
    );

    // Don't throw - log the error but don't fail the current story
    // The batch workflow can be resumed manually if needed
  }
}

/**
 * Handle batch workflow errors - continue with next story if possible
 */
async function handleBatchWorkflowError(
  batchDetail: BatchWorkflowEventDetail,
  error: unknown,
  preferences: UserPreferencesData,
  insights: QlooInsights
): Promise<void> {
  const {
    userId,
    workflowId,
    requestId,
    numberOfStories,
    currentBatch,
    totalBatches,
  } = batchDetail;

  ErrorLogger.logError(
    error instanceof Error ? error : new Error(String(error)),
    {
      userId,
      workflowId,
      requestId,
      currentBatch,
      totalBatches,
      operation: "BatchWorkflowStoryGeneration",
    },
    "StoryGeneration"
  );

  // Check if there are more stories to generate
  if (currentBatch < totalBatches) {
    ErrorLogger.logInfo(
      "Continuing batch workflow despite individual story failure",
      {
        userId,
        workflowId,
        failedBatch: currentBatch,
        nextBatch: currentBatch + 1,
        totalBatches,
      }
    );

    try {
      // Trigger next story generation despite the current failure
      const nextBatch = currentBatch + 1;
      const nextRequestId = `${requestId}-batch-${nextBatch}`;

      // Create generation request for next story
      await GenerationRequestAccess.create({
        userId,
        requestId: nextRequestId,
        type: "STORY",
        status: "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Publish next batch story generation event
      await EventPublishingHelpers.publishBatchStoryGeneration(
        userId,
        workflowId,
        nextRequestId,
        numberOfStories,
        nextBatch,
        totalBatches,
        preferences,
        insights
      );

      ErrorLogger.logInfo("Successfully continued batch workflow after error", {
        userId,
        workflowId,
        failedBatch: currentBatch,
        nextBatch,
        nextRequestId,
      });
    } catch (continuationError) {
      ErrorLogger.logError(
        continuationError instanceof Error
          ? continuationError
          : new Error(String(continuationError)),
        {
          userId,
          workflowId,
          currentBatch,
          operation: "ContinueBatchWorkflowAfterError",
        },
        "StoryGeneration"
      );
    }
  } else {
    ErrorLogger.logInfo("Batch workflow ended with final story failure", {
      userId,
      workflowId,
      finalBatch: currentBatch,
      totalBatches,
    });

    // Publish batch workflow failure event
    await EventPublishingHelpers.publishStatusUpdate(
      userId,
      requestId,
      "STORY",
      "FAILED",
      workflowId,
      `Batch workflow failed on final story: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Parse generated story content to extract title and main content
 */
function parseStoryContent(generatedContent: string): {
  title: string;
  content: string;
} {
  // Look for title patterns in the generated content
  const lines = generatedContent.split("\n");
  let title = "Untitled Story";
  let contentStartIndex = 0;

  // Try to find title in various formats
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();

    // Check for markdown title (# Title)
    if (line.startsWith("# ")) {
      title = line.substring(2).trim();
      contentStartIndex = i + 1;
      break;
    }

    // Check for "Title:" format
    if (line.toLowerCase().startsWith("title:")) {
      title = line.substring(6).trim();
      contentStartIndex = i + 1;
      continue;
    }

    // Check for bold title (**Title**)
    const boldMatch = line.match(/^\*\*(.*?)\*\*$/);
    if (boldMatch && boldMatch[1].trim().length > 0) {
      title = boldMatch[1].trim();
      contentStartIndex = i + 1;
      break;
    }
  }

  // Extract content (skip empty lines after title)
  while (
    contentStartIndex < lines.length &&
    lines[contentStartIndex].trim() === ""
  ) {
    contentStartIndex++;
  }

  const content = lines.slice(contentStartIndex).join("\n").trim();

  return { title, content };
}

// Export the handler wrapped with error handling
export const handler = withErrorHandling(
  storyGenerationHandler,
  "StoryGeneration"
);
