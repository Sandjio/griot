import { EventBridgeEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { StoryGenerationEventDetail } from "../../types/event-schemas";
import {
  StoryAccess,
  GenerationRequestAccess,
} from "../../database/access-patterns";
import { EventPublishingHelpers } from "../../utils/event-publisher";
import { createMangaStorageService } from "../../storage/manga-storage";
import { BedrockClient } from "./bedrock-client";
import { StoryContent } from "../../storage/manga-storage";

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

export const handler = async (event: StoryGenerationEvent): Promise<void> => {
  console.log("Story Generation Lambda invoked", {
    source: event.source,
    detailType: event["detail-type"],
    userId: event.detail.userId,
    requestId: event.detail.requestId,
  });

  const { userId, requestId, preferences, insights } = event.detail;

  // Input validation
  if (!userId || userId.trim() === "") {
    throw new Error("User ID is required and cannot be empty");
  }

  if (!preferences) {
    throw new Error("User preferences are required");
  }

  if (!insights) {
    throw new Error("User insights are required");
  }

  const storyId = uuidv4();
  const timestamp = new Date().toISOString();

  try {
    // Update generation request status to processing
    await GenerationRequestAccess.updateStatus(
      userId,
      requestId,
      "PROCESSING",
      {
        relatedEntityId: storyId,
      }
    );

    console.log("Starting story generation", {
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

    // Generate story content using Bedrock
    const storyResponse = await bedrockClient.generateStory(
      preferences,
      insights
    );

    console.log("Successfully generated story content", {
      userId,
      requestId,
      storyId,
      contentLength: storyResponse.content.length,
      tokensUsed:
        storyResponse.usage?.inputTokens +
        (storyResponse.usage?.outputTokens || 0),
    });

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
          storyResponse.usage?.inputTokens +
          (storyResponse.usage?.outputTokens || 0),
      },
    };

    // Initialize storage service
    const storageService = createMangaStorageService();

    // Save story to S3 as Markdown file
    const s3Reference = await storageService.saveStory(
      userId,
      storyId,
      storyContent
    );

    console.log("Successfully saved story to S3", {
      userId,
      requestId,
      storyId,
      s3Key: s3Reference.key,
      bucket: s3Reference.bucket,
    });

    // Store story metadata in DynamoDB
    await StoryAccess.create({
      storyId,
      userId,
      title,
      s3Key: s3Reference.key,
      status: "COMPLETED",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    console.log("Successfully stored story metadata in DynamoDB", {
      userId,
      requestId,
      storyId,
    });

    // Update generation request status to completed
    await GenerationRequestAccess.updateStatus(userId, requestId, "COMPLETED", {
      relatedEntityId: storyId,
    });

    // Publish episode generation event
    await EventPublishingHelpers.publishEpisodeGeneration(
      userId,
      storyId,
      s3Reference.key,
      1 // Start with episode 1
    );

    console.log("Successfully published episode generation event", {
      userId,
      requestId,
      storyId,
      episodeNumber: 1,
    });

    // Publish status update event
    await EventPublishingHelpers.publishStatusUpdate(
      userId,
      requestId,
      "STORY",
      "COMPLETED",
      storyId
    );

    console.log("Story generation completed successfully", {
      userId,
      requestId,
      storyId,
      title,
    });
  } catch (error) {
    console.error("Error in story generation", {
      userId,
      requestId,
      storyId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

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
      console.error("Error during cleanup after story generation failure", {
        userId,
        requestId,
        storyId,
        cleanupError:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }

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
