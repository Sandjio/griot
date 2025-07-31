import { EventBridgeEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  EpisodeGenerationEventDetail,
  ContinueEpisodeEventDetail,
} from "../../types/event-schemas";
import {
  StoryAccess,
  EpisodeAccess,
  GenerationRequestAccess,
  UserPreferencesAccess,
} from "../../database/access-patterns";
import { EventPublishingHelpers } from "../../utils/event-publisher";
import { createMangaStorageService } from "../../storage/manga-storage";
import { BedrockClient } from "./bedrock-client";
import { EpisodeContent } from "../../storage/manga-storage";
import { UserPreferencesData } from "../../types/data-models";
import {
  withErrorHandling,
  CorrelationContext,
  ErrorLogger,
} from "../../utils/error-handler";
import {
  BusinessMetrics,
  ExternalAPIMetrics,
  PerformanceTimer,
} from "../../utils/cloudwatch-metrics";
import AWSXRay from "aws-xray-sdk-core";

/**
 * Episode Generation Lambda Function
 *
 * Handles episode generation events from EventBridge, fetches story content from S3,
 * integrates with Amazon Bedrock for episode content generation, saves generated
 * episode as Markdown file to S3, stores episode metadata in DynamoDB, and
 * publishes events for image generation.
 *
 * Enhanced to support continue episode events for generating additional episodes
 * for existing stories with automatic episode numbering and original preferences.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6B.2, 6B.3, 6B.4, 6B.6
 */

interface EpisodeGenerationEvent
  extends EventBridgeEvent<
    "Episode Generation Requested",
    EpisodeGenerationEventDetail
  > {}

interface ContinueEpisodeEvent
  extends EventBridgeEvent<
    "Continue Episode Requested",
    ContinueEpisodeEventDetail
  > {}

type EpisodeEvent = EpisodeGenerationEvent | ContinueEpisodeEvent;

const episodeGenerationHandler = async (
  event: EpisodeEvent,
  correlationId: string
): Promise<void> => {
  // Start X-Ray subsegment for this operation
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment("EpisodeGeneration");
  
  const eventType = event["detail-type"];
  const isContinueEpisode = eventType === "Continue Episode Requested";
  const operationTimer = new PerformanceTimer("EpisodeGeneration");

  ErrorLogger.logInfo(
    "Episode Generation Lambda invoked",
    {
      source: event.source,
      detailType: eventType,
      userId: event.detail.userId,
      storyId: event.detail.storyId,
      isContinueEpisode,
      correlationId,
      traceId: segment?.trace_id,
    },
    "EpisodeGeneration"
  );
  
  // Add context to X-Ray
  subsegment?.addAnnotation("userId", event.detail.userId);
  subsegment?.addAnnotation("storyId", event.detail.storyId);
  subsegment?.addAnnotation("isContinueEpisode", isContinueEpisode);
  subsegment?.addAnnotation("eventType", eventType);
  
  if (isContinueEpisode) {
    const continueDetail = event.detail as ContinueEpisodeEventDetail;
    subsegment?.addAnnotation("nextEpisodeNumber", continueDetail.nextEpisodeNumber);
  } else {
    const regularDetail = event.detail as EpisodeGenerationEventDetail;
    subsegment?.addAnnotation("episodeNumber", regularDetail.episodeNumber);
  }

  try {
    // Handle different event types
    if (isContinueEpisode) {
      await handleContinueEpisodeEvent(
        event as ContinueEpisodeEvent,
        correlationId,
        subsegment
      );
    } else {
      await handleRegularEpisodeEvent(
        event as EpisodeGenerationEvent,
        correlationId,
        subsegment
      );
    }
    
    // Record success metrics
    const totalDuration = operationTimer.stop();
    const userId = event.detail.userId;
    const storyId = event.detail.storyId;
    
    if (isContinueEpisode) {
      const episodeNumber = (event.detail as ContinueEpisodeEventDetail).nextEpisodeNumber;
      await BusinessMetrics.recordEpisodeContinuationSuccess(
        userId,
        storyId,
        episodeNumber,
        totalDuration
      );
    } else {
      await BusinessMetrics.recordEpisodeGenerationSuccess(userId, totalDuration);
    }
    
    subsegment?.addAnnotation("success", true);
    subsegment?.addMetadata("performance", { totalDuration });
    subsegment?.close();
    
  } catch (error) {
    const totalDuration = operationTimer.stop();
    const userId = event.detail.userId;
    const storyId = event.detail.storyId;
    const errorType = error instanceof Error ? error.constructor.name : "UNKNOWN_ERROR";
    
    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        userId,
        storyId,
        isContinueEpisode,
        totalDuration,
        operation: "EpisodeGeneration",
      },
      "EpisodeGeneration"
    );
    
    // Record failure metrics
    if (isContinueEpisode) {
      const episodeNumber = (event.detail as ContinueEpisodeEventDetail).nextEpisodeNumber;
      await BusinessMetrics.recordEpisodeContinuationFailure(
        userId,
        storyId,
        errorType,
        episodeNumber
      );
    } else {
      await BusinessMetrics.recordEpisodeGenerationFailure(userId, errorType);
    }
    
    subsegment?.addError(error instanceof Error ? error : new Error(String(error)));
    subsegment?.addAnnotation("success", false);
    subsegment?.addMetadata("error", {
      message: error instanceof Error ? error.message : String(error),
      type: errorType,
      totalDuration,
    });
    subsegment?.close();
    
    throw error;
  }
};

/**
 * Handle regular episode generation events
 */
async function handleRegularEpisodeEvent(
  event: EpisodeGenerationEvent,
  correlationId: string,
  subsegment?: any
): Promise<void> {
  const { userId, storyId, storyS3Key, episodeNumber } = event.detail;

  // Input validation
  if (!userId || userId.trim() === "") {
    throw new Error("User ID is required and cannot be empty");
  }

  if (!storyId || storyId.trim() === "") {
    throw new Error("Story ID is required and cannot be empty");
  }

  if (!storyS3Key || storyS3Key.trim() === "") {
    throw new Error("Story S3 key is required and cannot be empty");
  }

  if (!episodeNumber || episodeNumber < 1) {
    throw new Error("Episode number must be a positive integer");
  }

  await generateEpisode({
    userId,
    storyId,
    episodeNumber,
    storyS3Key,
    originalPreferences: undefined, // Will be fetched if needed
  });
}

/**
 * Handle continue episode events with automatic episode numbering
 */
async function handleContinueEpisodeEvent(
  event: ContinueEpisodeEvent,
  correlationId: string,
  subsegment?: any
): Promise<void> {
  const {
    userId,
    storyId,
    nextEpisodeNumber,
    originalPreferences,
    storyS3Key,
  } = event.detail;

  // Input validation
  if (!userId || userId.trim() === "") {
    throw new Error("User ID is required and cannot be empty");
  }

  if (!storyId || storyId.trim() === "") {
    throw new Error("Story ID is required and cannot be empty");
  }

  if (!storyS3Key || storyS3Key.trim() === "") {
    throw new Error("Story S3 key is required and cannot be empty");
  }

  if (!nextEpisodeNumber || nextEpisodeNumber < 1) {
    throw new Error("Next episode number must be a positive integer");
  }

  if (!originalPreferences) {
    throw new Error(
      "Original preferences are required for continue episode events"
    );
  }

  console.log("Processing continue episode request", {
    userId,
    storyId,
    nextEpisodeNumber,
    hasOriginalPreferences: !!originalPreferences,
  });

  await generateEpisode({
    userId,
    storyId,
    episodeNumber: nextEpisodeNumber,
    storyS3Key,
    originalPreferences,
  });
}

/**
 * Core episode generation logic shared by both event types
 */
async function generateEpisode({
  userId,
  storyId,
  episodeNumber,
  storyS3Key,
  originalPreferences,
}: {
  userId: string;
  storyId: string;
  episodeNumber: number;
  storyS3Key: string;
  originalPreferences?: UserPreferencesData;
}): Promise<void> {
  const episodeId = uuidv4();
  const timestamp = new Date().toISOString();

  try {
    console.log("Starting episode generation", {
      userId,
      storyId,
      episodeId,
      episodeNumber,
      storyS3Key,
      isContinueEpisode: !!originalPreferences,
    });

    // Verify story exists and get story metadata
    const story = await StoryAccess.getByStoryId(storyId);
    if (!story) {
      throw new Error(`Story not found: ${storyId}`);
    }

    if (story.status !== "COMPLETED") {
      throw new Error(
        `Story is not completed. Current status: ${story.status}`
      );
    }

    // For continue episodes, verify the episode number is sequential
    if (originalPreferences) {
      const existingEpisodes = await EpisodeAccess.getStoryEpisodes(storyId);
      const maxEpisodeNumber =
        existingEpisodes.length > 0
          ? Math.max(...existingEpisodes.map((ep) => ep.episodeNumber))
          : 0;

      if (episodeNumber !== maxEpisodeNumber + 1) {
        throw new Error(
          `Invalid episode number for continuation. Expected ${
            maxEpisodeNumber + 1
          }, got ${episodeNumber}`
        );
      }
    }

    // Check if episode already exists
    const existingEpisode = await EpisodeAccess.get(storyId, episodeNumber);
    if (existingEpisode && existingEpisode.status === "COMPLETED") {
      console.log("Episode already exists and is completed", {
        episodeId: existingEpisode.episodeId,
        status: existingEpisode.status,
      });

      // Publish image generation event for existing episode
      await EventPublishingHelpers.publishImageGeneration(
        userId,
        existingEpisode.episodeId,
        existingEpisode.s3Key
      );

      return;
    }

    // Create episode record with PROCESSING status
    await EpisodeAccess.create({
      episodeId,
      episodeNumber,
      storyId,
      s3Key: "", // Will be updated after S3 save
      status: "PROCESSING",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    console.log("Created episode record in DynamoDB", {
      episodeId,
      episodeNumber,
      storyId,
      status: "PROCESSING",
    });

    // Initialize storage service
    const storageService = createMangaStorageService();

    // Fetch story content from S3
    console.log("Fetching story content from S3", {
      storyS3Key,
      userId,
      storyId,
    });

    const storyContent = await storageService.getStory(userId, storyId);

    if (!storyContent || storyContent.trim() === "") {
      throw new Error("Story content is empty or not found in S3");
    }

    console.log("Successfully fetched story content", {
      contentLength: storyContent.length,
      storyId,
    });

    // Get user preferences for episode generation context
    let userPreferences = originalPreferences;
    if (!userPreferences) {
      console.log("Fetching user preferences for episode generation context");
      const preferencesData = await UserPreferencesAccess.getLatestWithMetadata(
        userId
      );
      userPreferences = preferencesData.preferences;

      if (!userPreferences) {
        console.warn(
          "No user preferences found, proceeding without preferences context"
        );
      }
    }

    // Initialize Bedrock client for episode generation
    const bedrockClient = new BedrockClient();

    // Generate episode content using Bedrock with preferences context
    const episodeResponse = userPreferences
      ? await bedrockClient.generateEpisodeWithPreferences(
          storyContent,
          episodeNumber,
          story.title,
          userPreferences
        )
      : await bedrockClient.generateEpisode(
          storyContent,
          episodeNumber,
          story.title
        );

    console.log("Successfully generated episode content", {
      userId,
      storyId,
      episodeId,
      episodeNumber,
      contentLength: episodeResponse.content.length,
      tokensUsed:
        (episodeResponse.usage?.inputTokens || 0) +
        (episodeResponse.usage?.outputTokens || 0),
      hasPreferences: !!userPreferences,
    });

    // Parse the generated episode content to extract title and content
    const { title, content } = parseEpisodeContent(
      episodeResponse.content,
      episodeNumber
    );

    // Create episode content object
    const episodeContent: EpisodeContent = {
      episodeNumber,
      title,
      content,
      storyId,
      metadata: {
        episodeId,
        userId,
        storyId,
        storyTitle: story.title,
        generatedAt: timestamp,
        tokensUsed: String(
          (episodeResponse.usage?.inputTokens || 0) +
            (episodeResponse.usage?.outputTokens || 0)
        ),
        isContinueEpisode: !!originalPreferences,
        hasPreferencesContext: !!userPreferences,
      },
    };

    // Save episode to S3 as Markdown file
    const s3Reference = await storageService.saveEpisode(
      userId,
      storyId,
      episodeContent
    );

    console.log("Successfully saved episode to S3", {
      userId,
      storyId,
      episodeId,
      episodeNumber,
      s3Key: s3Reference.key,
      bucket: s3Reference.bucket,
    });

    // Update episode metadata in DynamoDB with S3 key and completed status
    await EpisodeAccess.updateStatus(storyId, episodeNumber, "COMPLETED", {
      s3Key: s3Reference.key,
      title,
      isContinueEpisode: !!originalPreferences,
    });

    console.log("Successfully updated episode metadata in DynamoDB", {
      userId,
      storyId,
      episodeId,
      episodeNumber,
      s3Key: s3Reference.key,
    });

    // Publish image generation event
    await EventPublishingHelpers.publishImageGeneration(
      userId,
      episodeId,
      s3Reference.key
    );

    console.log("Successfully published image generation event", {
      userId,
      storyId,
      episodeId,
      episodeNumber,
    });

    // Publish status update event (non-blocking)
    try {
      await EventPublishingHelpers.publishStatusUpdate(
        userId,
        story.userId, // Use the story's associated request ID if available
        "EPISODE",
        "COMPLETED",
        episodeId
      );
      console.log("Successfully published status update event", {
        userId,
        storyId,
        episodeId,
        episodeNumber,
      });
    } catch (statusError) {
      console.warn("Failed to publish status update event (non-critical)", {
        userId,
        storyId,
        episodeId,
        episodeNumber,
        error:
          statusError instanceof Error
            ? statusError.message
            : String(statusError),
      });
    }

    console.log("Episode generation completed successfully", {
      userId,
      storyId,
      episodeId,
      episodeNumber,
      title,
      isContinueEpisode: !!originalPreferences,
    });
  } catch (error) {
    console.error("Error in episode generation", {
      userId,
      storyId,
      episodeId,
      episodeNumber,
      isContinueEpisode: !!originalPreferences,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    try {
      // Update episode status to failed if it was created
      const existingEpisode = await EpisodeAccess.get(storyId, episodeNumber);
      if (existingEpisode) {
        await EpisodeAccess.updateStatus(storyId, episodeNumber, "FAILED", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }

      // Publish status update event for failure (non-blocking)
      try {
        await EventPublishingHelpers.publishStatusUpdate(
          userId,
          storyId, // Use storyId as fallback for requestId
          "EPISODE",
          "FAILED",
          episodeId,
          error instanceof Error ? error.message : String(error)
        );
      } catch (statusError) {
        console.warn(
          "Failed to publish failure status update event (non-critical)",
          {
            userId,
            storyId,
            episodeId,
            episodeNumber,
            statusError:
              statusError instanceof Error
                ? statusError.message
                : String(statusError),
          }
        );
      }
    } catch (cleanupError) {
      console.error("Error during cleanup after episode generation failure", {
        userId,
        storyId,
        episodeId,
        episodeNumber,
        cleanupError:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }

    // Re-throw the original error to trigger Lambda retry/DLQ
    throw error;
  }
}

/**
 * Parse generated episode content to extract title and main content
 */
function parseEpisodeContent(
  generatedContent: string,
  episodeNumber: number
): {
  title: string;
  content: string;
} {
  // Look for title patterns in the generated content
  const lines = generatedContent.split("\n");
  let title = `Episode ${episodeNumber}`;
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

    // Check for "Episode X:" format
    const episodeMatch = line.match(/^Episode\s+\d+:\s*(.+)$/i);
    if (episodeMatch && episodeMatch[1].trim().length > 0) {
      title = `Episode ${episodeNumber}: ${episodeMatch[1].trim()}`;
      contentStartIndex = i + 1;
      break;
    }

    // Check for "Title:" format
    if (line.toLowerCase().startsWith("title:")) {
      const titleText = line.substring(6).trim();
      title = titleText.startsWith("Episode")
        ? titleText
        : `Episode ${episodeNumber}: ${titleText}`;
      contentStartIndex = i + 1;
      continue;
    }

    // Check for bold title (**Title**)
    const boldMatch = line.match(/^\*\*(.*?)\*\*$/);
    if (boldMatch && boldMatch[1].trim().length > 0) {
      const titleText = boldMatch[1].trim();
      title = titleText.startsWith("Episode")
        ? titleText
        : `Episode ${episodeNumber}: ${titleText}`;
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
  episodeGenerationHandler,
  "EpisodeGeneration"
);
