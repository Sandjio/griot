import { EventBridgeEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { ImageGenerationEventDetail } from "../../types/event-schemas";
import {
  EpisodeAccess,
  GenerationRequestAccess,
} from "../../database/access-patterns";
import { EventPublishingHelpers } from "../../utils/event-publisher";
import { createMangaStorageService } from "../../storage/manga-storage";
import { BedrockImageClient } from "./bedrock-client";
import { PDFGenerator } from "./pdf-generator";
import {
  withErrorHandling,
  CorrelationContext,
  ErrorLogger,
} from "../../utils/error-handler";

/**
 * Image Generation Lambda Function
 *
 * Handles image generation events from EventBridge, fetches episode content from S3,
 * integrates with Amazon Bedrock for image generation, creates PDF files combining
 * images and episode text, saves generated images and PDF files to S3, and stores
 * image and PDF metadata in DynamoDB.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

interface ImageGenerationEvent
  extends EventBridgeEvent<
    "Image Generation Requested",
    ImageGenerationEventDetail
  > {}

const imageGenerationHandler = async (
  event: ImageGenerationEvent,
  correlationId: string
): Promise<void> => {
  ErrorLogger.logInfo(
    "Image Generation Lambda invoked",
    {
      source: event.source,
      detailType: event["detail-type"],
      userId: event.detail.userId,
      episodeId: event.detail.episodeId,
      episodeS3Key: event.detail.episodeS3Key,
      correlationId,
    },
    "ImageGeneration"
  );

  const { userId, episodeId, episodeS3Key } = event.detail;

  // Input validation
  if (!userId || userId.trim() === "") {
    throw new Error("User ID is required and cannot be empty");
  }

  if (!episodeId || episodeId.trim() === "") {
    throw new Error("Episode ID is required and cannot be empty");
  }

  if (!episodeS3Key || episodeS3Key.trim() === "") {
    throw new Error("Episode S3 key is required and cannot be empty");
  }

  const timestamp = new Date().toISOString();

  try {
    console.log("Starting image generation", {
      userId,
      episodeId,
      episodeS3Key,
    });

    // Initialize storage service
    const storageService = createMangaStorageService();

    // Parse episode S3 key to extract storyId and episodeNumber
    const { storyId, episodeNumber } = parseEpisodeS3Key(episodeS3Key);

    // Verify episode exists and get episode metadata
    const episode = await EpisodeAccess.get(storyId, episodeNumber);
    if (!episode) {
      throw new Error(`Episode not found: ${storyId}/${episodeNumber}`);
    }

    if (episode.status !== "COMPLETED") {
      throw new Error(
        `Episode is not completed. Current status: ${episode.status}`
      );
    }

    // Check if images and PDF already exist
    if (episode.pdfS3Key) {
      console.log("Images and PDF already exist for episode", {
        episodeId: episode.episodeId,
        pdfS3Key: episode.pdfS3Key,
      });

      // Publish completion event
      await EventPublishingHelpers.publishStatusUpdate(
        userId,
        episodeId,
        "IMAGE",
        "COMPLETED",
        episodeId
      );

      return;
    }

    // Update episode status to indicate image generation is in progress
    await EpisodeAccess.updateStatus(storyId, episodeNumber, "PROCESSING", {
      imageGenerationStarted: timestamp,
    });

    console.log("Updated episode status to PROCESSING for image generation", {
      episodeId,
      storyId,
      episodeNumber,
    });

    // Fetch episode content from S3
    console.log("Fetching episode content from S3", {
      episodeS3Key,
      userId,
      storyId,
      episodeNumber,
    });

    const episodeContent = await storageService.getEpisode(
      userId,
      storyId,
      episodeNumber
    );

    if (!episodeContent || episodeContent.trim() === "") {
      throw new Error("Episode content is empty or not found in S3");
    }

    console.log("Successfully fetched episode content", {
      contentLength: episodeContent.length,
      episodeId,
    });

    // Parse episode content to extract scenes for image generation
    const scenes = parseEpisodeScenes(episodeContent);

    console.log("Parsed episode scenes for image generation", {
      episodeId,
      sceneCount: scenes.length,
    });

    // Initialize Bedrock image client
    const bedrockImageClient = new BedrockImageClient();

    // Generate images for each scene
    const generatedImages: Array<{
      imageIndex: number;
      imageData: Buffer;
      prompt: string;
      filename: string;
    }> = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imageIndex = i + 1;

      console.log(`Generating image ${imageIndex} of ${scenes.length}`, {
        episodeId,
        sceneDescription: scene.description.substring(0, 100) + "...",
      });

      try {
        const imageResponse = await bedrockImageClient.generateImage(
          scene.description,
          scene.style || "manga style"
        );

        const filename = `image-${imageIndex.toString().padStart(3, "0")}.png`;

        generatedImages.push({
          imageIndex,
          imageData: imageResponse.imageData,
          prompt: scene.description,
          filename,
        });

        // Save individual image to S3
        await storageService.saveImage(
          userId,
          storyId,
          episodeNumber,
          imageIndex,
          {
            imageData: imageResponse.imageData,
            filename,
            contentType: "image/png",
          }
        );

        console.log(`Successfully generated and saved image ${imageIndex}`, {
          episodeId,
          filename,
          imageSize: imageResponse.imageData.length,
        });

        // Add delay between image generations to avoid rate limiting
        if (i < scenes.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (imageError) {
        console.error(`Failed to generate image ${imageIndex}`, {
          episodeId,
          error:
            imageError instanceof Error
              ? imageError.message
              : String(imageError),
        });

        // Continue with other images even if one fails
        // Create a placeholder image or skip this image
        continue;
      }
    }

    if (generatedImages.length === 0) {
      throw new Error("No images were successfully generated");
    }

    console.log("Successfully generated all images", {
      episodeId,
      totalImages: generatedImages.length,
      requestedImages: scenes.length,
    });

    // Create PDF combining images and episode text
    console.log("Creating PDF with images and episode text", {
      episodeId,
      imageCount: generatedImages.length,
    });

    const pdfGenerator = new PDFGenerator();
    const pdfBuffer = await pdfGenerator.createEpisodePDF(
      episodeContent,
      generatedImages,
      {
        episodeId,
        episodeNumber,
        storyId,
        userId,
      }
    );

    console.log("Successfully created PDF", {
      episodeId,
      pdfSize: pdfBuffer.length,
    });

    // Save PDF to S3
    const pdfReference = await storageService.saveEpisodePDF(
      userId,
      storyId,
      episodeNumber,
      pdfBuffer
    );

    console.log("Successfully saved PDF to S3", {
      episodeId,
      pdfS3Key: pdfReference.key,
      pdfSize: pdfBuffer.length,
    });

    // Update episode metadata in DynamoDB with PDF reference and completed status
    await EpisodeAccess.updateStatus(storyId, episodeNumber, "COMPLETED", {
      pdfS3Key: pdfReference.key,
      imageCount: generatedImages.length,
      imageGenerationCompleted: timestamp,
    });

    console.log("Successfully updated episode metadata in DynamoDB", {
      episodeId,
      storyId,
      episodeNumber,
      pdfS3Key: pdfReference.key,
      imageCount: generatedImages.length,
    });

    // Publish completion event
    await EventPublishingHelpers.publishStatusUpdate(
      userId,
      episodeId,
      "IMAGE",
      "COMPLETED",
      episodeId
    );

    console.log("Image generation completed successfully", {
      userId,
      episodeId,
      storyId,
      episodeNumber,
      imageCount: generatedImages.length,
      pdfS3Key: pdfReference.key,
    });
  } catch (error) {
    console.error("Error in image generation", {
      userId,
      episodeId,
      episodeS3Key,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    try {
      // Parse episode S3 key to get storyId and episodeNumber for cleanup
      const { storyId, episodeNumber } = parseEpisodeS3Key(episodeS3Key);

      // Update episode status to failed
      const existingEpisode = await EpisodeAccess.get(storyId, episodeNumber);
      if (existingEpisode) {
        await EpisodeAccess.updateStatus(storyId, episodeNumber, "FAILED", {
          errorMessage: error instanceof Error ? error.message : String(error),
          imageGenerationFailed: timestamp,
        });
      }

      // Publish status update event for failure
      await EventPublishingHelpers.publishStatusUpdate(
        userId,
        episodeId,
        "IMAGE",
        "FAILED",
        episodeId,
        error instanceof Error ? error.message : String(error)
      );
    } catch (cleanupError) {
      console.error("Error during cleanup after image generation failure", {
        userId,
        episodeId,
        episodeS3Key,
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
 * Parse episode S3 key to extract storyId and episodeNumber
 */
function parseEpisodeS3Key(episodeS3Key: string): {
  storyId: string;
  episodeNumber: number;
} {
  // Expected format: episodes/{userId}/{storyId}/{episodeNumber}/episode.md
  const parts = episodeS3Key.split("/");

  if (parts.length < 4) {
    throw new Error(`Invalid episode S3 key format: ${episodeS3Key}`);
  }

  const storyId = parts[2];
  const episodeNumber = parseInt(parts[3], 10);

  if (!storyId || isNaN(episodeNumber) || episodeNumber < 1) {
    throw new Error(`Invalid episode S3 key format: ${episodeS3Key}`);
  }

  return { storyId, episodeNumber };
}

/**
 * Parse episode content to extract scenes for image generation
 */
function parseEpisodeScenes(episodeContent: string): Array<{
  description: string;
  style?: string;
}> {
  const scenes: Array<{ description: string; style?: string }> = [];

  // Remove markdown metadata if present
  let content = episodeContent;
  if (content.startsWith("---")) {
    const endOfMetadata = content.indexOf("---", 3);
    if (endOfMetadata !== -1) {
      content = content.substring(endOfMetadata + 3).trim();
    }
  }

  // Split content into paragraphs
  const paragraphs = content
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Look for scene breaks and visual descriptions
  let currentScene = "";
  const sceneBreakPatterns = [
    /\[Scene Break\]/i,
    /\[New Scene\]/i,
    /---/,
    /\*\*\*\*/,
  ];

  const visualDescriptionPatterns = [
    /\[.*?\]/g, // [visual description]
    /\(.*?\)/g, // (visual description)
  ];

  for (const paragraph of paragraphs) {
    // Check if this paragraph is a scene break
    const isSceneBreak = sceneBreakPatterns.some((pattern) =>
      pattern.test(paragraph)
    );

    if (isSceneBreak) {
      // Save current scene if it has content
      if (currentScene.trim().length > 0) {
        scenes.push({
          description: extractVisualDescription(currentScene),
        });
      }
      currentScene = "";
      continue;
    }

    // Add paragraph to current scene
    currentScene += (currentScene ? "\n\n" : "") + paragraph;
  }

  // Add the last scene if it has content
  if (currentScene.trim().length > 0) {
    scenes.push({
      description: extractVisualDescription(currentScene),
    });
  }

  // If no scenes were found, create scenes from paragraphs
  if (scenes.length === 0) {
    // Group paragraphs into scenes (every 2-3 paragraphs)
    for (let i = 0; i < paragraphs.length; i += 3) {
      const sceneContent = paragraphs.slice(i, i + 3).join("\n\n");
      scenes.push({
        description: extractVisualDescription(sceneContent),
      });
    }
  }

  // Limit to maximum 8 scenes to avoid too many images
  const maxScenes = 8;
  if (scenes.length > maxScenes) {
    console.log(`Limiting scenes from ${scenes.length} to ${maxScenes}`);
    return scenes.slice(0, maxScenes);
  }

  return scenes;
}

/**
 * Extract visual description from scene content for image generation
 */
function extractVisualDescription(sceneContent: string): string {
  // Start with the raw content
  let description = sceneContent.trim();

  // Remove markdown metadata if present
  if (description.startsWith("---")) {
    const endOfMetadata = description.indexOf("---", 3);
    if (endOfMetadata !== -1) {
      description = description.substring(endOfMetadata + 3).trim();
    }
  }

  // Remove dialogue (text in quotes)
  description = description.replace(/"[^"]*"/g, "");
  description = description.replace(/'[^']*'/g, "");

  // Remove character names and dialogue markers more aggressively
  description = description.replace(/^[A-Za-z]+\s*:/gm, "");
  description = description.replace(/\b[A-Za-z]+\s*:/g, "");
  description = description.replace(/^[A-Za-z]+\s*\(/gm, "");

  // Remove chapter/episode titles and headers
  description = description.replace(/^(Chapter|Episode)\s+\d+.*$/gm, "");
  description = description.replace(/^[A-Z][A-Za-z\s]+$/gm, ""); // Remove title-like lines

  // Extract and preserve visual cues in brackets or parentheses
  const visualCues: string[] = [];
  const bracketMatches = description.match(/\[[^\]]+\]/g);
  const parenMatches = description.match(/\([^)]+\)/g);

  if (bracketMatches) {
    visualCues.push(...bracketMatches.map((m) => m.slice(1, -1).trim()));
  }
  if (parenMatches) {
    visualCues.push(...parenMatches.map((m) => m.slice(1, -1).trim()));
  }

  // Remove visual cues from main description
  description = description.replace(/\[[^\]]+\]/g, "");
  description = description.replace(/\([^)]+\)/g, "");

  // Clean up markdown and formatting
  description = description.replace(/[#*_`]/g, "");
  description = description.replace(/\*\*/g, "");
  description = description.replace(/_{2,}/g, "");

  // Remove problematic characters that cause Bedrock issues
  description = description.replace(/[:\[\]{}]/g, "");
  description = description.replace(/\s+/g, " ");

  // Split into sentences and filter meaningful ones
  const sentences = description
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      // Filter out very short sentences, single words, or character names
      return (
        sentence.length > 10 &&
        !sentence.match(/^[A-Za-z]+$/) && // Single words
        !sentence.match(/^[A-Za-z]+\s+[A-Za-z]+$/) && // Two words (likely names)
        sentence.includes(" ") // Must have spaces (actual sentences)
      );
    });

  // Take the most descriptive sentences
  let finalDescription = sentences.slice(0, 3).join(". ");

  // Add visual cues if we have them
  if (visualCues.length > 0) {
    const cleanedCues = visualCues
      .map((cue) => cue.replace(/[:\[\]{}]/g, "").trim())
      .filter((cue) => cue.length > 5);
    if (cleanedCues.length > 0) {
      finalDescription += ". " + cleanedCues.slice(0, 2).join(". ");
    }
  }

  // Final cleanup
  finalDescription = finalDescription
    .replace(/[:\[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();

  // Ensure we have meaningful content
  if (finalDescription.length < 15) {
    finalDescription =
      "A dramatic manga scene with characters in intense action";
  }

  // Limit description length for Bedrock (keep it shorter)
  if (finalDescription.length > 300) {
    finalDescription = finalDescription.substring(0, 300).trim();
    // Ensure we don't cut off mid-word
    const lastSpace = finalDescription.lastIndexOf(" ");
    if (lastSpace > 250) {
      finalDescription = finalDescription.substring(0, lastSpace);
    }
  }

  // Create a clean, simple prompt for Stable Diffusion
  const cleanPrompt = `Manga illustration of ${finalDescription}`;

  return cleanPrompt;
}

// Export the handler wrapped with error handling
export const handler = withErrorHandling(
  imageGenerationHandler,
  "ImageGeneration"
);
