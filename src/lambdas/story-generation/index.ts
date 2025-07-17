import { EventBridgeEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import AWSXRay from "aws-xray-sdk-core";
import { StoryGenerationEventDetail } from "../../types/event-schemas";
import {
  StoryAccess,
  GenerationRequestAccess,
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

// Enable X-Ray tracing for AWS SDK
const AWS = AWSXRay.captureAWS(require("aws-sdk"));

/**
 * Story Generation Lambda Function
 *
 * Handles story generation events from EventBridge, integrates with Amazon Bedrock
 * for story content generation, saves generated story as Markdown file to S3,
 * stores story metadata in DynamoDB, and publishes events for episode generation.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

interface StoryGenerationEvent
  extends EventBridgeEvent<
    "Story Generation Requested",
    StoryGenerationEventDetail
  > {}

const storyGenerationHandler = async (
  event: StoryGenerationEvent,
  correlationId: string
): Promise<void> => {
  // Start X-Ray subsegment for this operation
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment("StoryGeneration");

  // Start performance timer
  const operationTimer = new PerformanceTimer("StoryGeneration");

  ErrorLogger.logInfo(
    "Story Generation Lambda invoked",
    {
      source: event.source,
      detailType: event["detail-type"],
      userId: event.detail.userId,
      requestId: event.detail.requestId,
      correlationId,
      traceId: segment?.trace_id,
    },
    "StoryGeneration"
  );

  const { userId, requestId, preferences, insights } = event.detail;

  // Input validation
  if (!userId || userId.trim() === "") {
    const error = new Error("User ID is required and cannot be empty");
    subsegment?.addError(error);
    subsegment?.close();
    throw error;
  }

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
  subsegment?.addMetadata("preferences", {
    genres: preferences.genres,
    themes: preferences.themes,
    artStyle: preferences.artStyle,
    targetAudience: preferences.targetAudience,
    contentRating: preferences.contentRating,
  });

  try {
    // Update generation request status to processing
    const dbTimer = new PerformanceTimer("DynamoDB-UpdateStatus");
    await GenerationRequestAccess.updateStatus(
      userId,
      requestId,
      "PROCESSING",
      {
        relatedEntityId: storyId,
      }
    );
    const dbDuration = dbTimer.stop();

    ErrorLogger.logInfo("Starting story generation", {
      userId,
      requestId,
      storyId,
      preferences: {
        genres: preferences.genres,
        themes: preferences.themes,
        artStyle: preferences.artStyle,
        targetAudience: preferences.targetAudience,
        contentRating: preferences.contentRating,
      },
    });

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
        insights: JSON.stringify(insights),
        generatedAt: timestamp,
        tokensUsed:
          (storyResponse.usage?.inputTokens || 0) +
          (storyResponse.usage?.outputTokens || 0),
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

    // Record successful completion metrics
    const totalDuration = operationTimer.stop();
    await BusinessMetrics.recordStoryGenerationSuccess(userId, totalDuration);

    // Add success annotations to X-Ray
    subsegment?.addAnnotation("success", true);
    subsegment?.addAnnotation("storyTitle", title);
    subsegment?.addMetadata("performance", {
      totalDuration,
      bedrockDuration: bedrockTimer.stop(),
      s3Duration,
      storeDuration,
      eventDuration,
    });
    subsegment?.close();

    ErrorLogger.logInfo("Story generation completed successfully", {
      userId,
      requestId,
      storyId,
      title,
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
        totalDuration,
        operation: "StoryGeneration",
      },
      "StoryGeneration"
    );

    // Record failure metrics
    const errorType =
      error instanceof Error ? error.constructor.name : "UNKNOWN_ERROR";
    await BusinessMetrics.recordStoryGenerationFailure(userId, errorType);

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

    // Re-throw the original error to trigger Lambda retry/DLQ
    throw error;
  }
};

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
