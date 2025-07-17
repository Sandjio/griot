/**
 * Integration tests for EventBridge event flows
 * Tests the complete event-driven architecture
 */

import { EventBridgeEvent } from "aws-lambda";
import { handler as storyGenerationHandler } from "../lambdas/story-generation/index";
import { handler as episodeGenerationHandler } from "../lambdas/episode-generation/index";
import { handler as imageGenerationHandler } from "../lambdas/image-generation/index";
import { EventPublishingHelpers } from "../utils/event-publisher";
import {
  StoryAccess,
  EpisodeAccess,
  GenerationRequestAccess,
} from "../database/access-patterns";
import { S3Operations } from "../storage/s3-client";
import { BedrockClient } from "../lambdas/story-generation/bedrock-client";
import { BedrockClient as EpisodeBedrockClient } from "../lambdas/episode-generation/bedrock-client";
import { BedrockClient as ImageBedrockClient } from "../lambdas/image-generation/bedrock-client";
import {
  EventBridgeEventFactory,
  LambdaContextFactory,
  TestDataFactory,
  MockSetupUtils,
} from "./test-utils";

// Mock all dependencies
jest.mock("../utils/event-publisher");
jest.mock("../database/access-patterns");
jest.mock("../storage/s3-client");
jest.mock("../lambdas/story-generation/bedrock-client");
jest.mock("../lambdas/episode-generation/bedrock-client");
jest.mock("../lambdas/image-generation/bedrock-client");

const mockEventPublishingHelpers = EventPublishingHelpers as jest.Mocked<
  typeof EventPublishingHelpers
>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
const mockS3Operations = S3Operations as jest.Mocked<typeof S3Operations>;
const mockBedrockClient = BedrockClient as jest.MockedClass<
  typeof BedrockClient
>;
const mockEpisodeBedrockClient = EpisodeBedrockClient as jest.MockedClass<
  typeof EpisodeBedrockClient
>;
const mockImageBedrockClient = ImageBedrockClient as jest.MockedClass<
  typeof ImageBedrockClient
>;

describe("EventBridge Integration Tests", () => {
  const mockContext = LambdaContextFactory.createContext(
    "eventbridge-integration"
  );

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();

    // Setup default mocks
    mockEventPublishingHelpers.publishEpisodeGeneration.mockResolvedValue();
    mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
    mockStoryAccess.create.mockResolvedValue();
    mockEpisodeAccess.create.mockResolvedValue();
    mockGenerationRequestAccess.updateStatus.mockResolvedValue();
    mockS3Operations.uploadText.mockResolvedValue("test-s3-key");
    mockS3Operations.getTextContent.mockResolvedValue("Test story content");
    mockS3Operations.uploadBuffer.mockResolvedValue("test-pdf-s3-key");
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  describe("Story Generation Event Flow", () => {
    it("should handle complete story generation workflow", async () => {
      const event = EventBridgeEventFactory.createStoryGenerationEvent();

      // Mock Bedrock client
      const mockBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Test Adventure Story",
          content: "# Chapter 1\n\nOnce upon a time...",
          metadata: {
            wordCount: 1000,
            estimatedReadingTime: 5,
          },
        }),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      const result = await storyGenerationHandler(event, mockContext);

      // Verify story generation
      expect(mockBedrockInstance.generateStory).toHaveBeenCalledWith(
        event.detail.preferences,
        event.detail.insights
      );

      // Verify S3 upload
      expect(mockS3Operations.uploadText).toHaveBeenCalledWith(
        expect.stringContaining("stories/test-user-123/"),
        "# Chapter 1\n\nOnce upon a time...",
        "text/markdown"
      );

      // Verify database storage
      expect(mockStoryAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test-user-123",
          title: "Test Adventure Story",
          status: "COMPLETED",
        })
      );

      // Verify episode generation event published
      expect(
        mockEventPublishingHelpers.publishEpisodeGeneration
      ).toHaveBeenCalledWith(
        "test-user-123",
        expect.any(String), // storyId
        expect.stringContaining("stories/test-user-123/"),
        1
      );

      // Verify request status updated
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "PROCESSING",
        expect.objectContaining({
          currentStep: "EPISODE_GENERATION",
          progress: 33,
        })
      );

      expect(result).toBeUndefined(); // EventBridge handlers don't return values
    });

    it("should handle story generation failures gracefully", async () => {
      const event = EventBridgeEventFactory.createStoryGenerationEvent();

      const mockBedrockInstance = {
        generateStory: jest
          .fn()
          .mockRejectedValue(new Error("Bedrock API error")),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      await expect(storyGenerationHandler(event, mockContext)).rejects.toThrow(
        "Bedrock API error"
      );

      // Verify request status updated to failed
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "FAILED",
        expect.objectContaining({
          errorMessage: expect.stringContaining("story generation"),
        })
      );

      // Verify no episode generation event published
      expect(
        mockEventPublishingHelpers.publishEpisodeGeneration
      ).not.toHaveBeenCalled();
    });
  });

  describe("Episode Generation Event Flow", () => {
    it("should handle complete episode generation workflow", async () => {
      const event = EventBridgeEventFactory.createEpisodeGenerationEvent();

      const mockBedrockInstance = {
        generateEpisode: jest.fn().mockResolvedValue({
          content: "Episode 1 content with dialogue and scenes",
          metadata: {
            wordCount: 500,
            sceneCount: 3,
          },
        }),
      };
      mockEpisodeBedrockClient.mockImplementation(
        () => mockBedrockInstance as any
      );

      const result = await episodeGenerationHandler(event, mockContext);

      // Verify story content fetched
      expect(mockS3Operations.getTextContent).toHaveBeenCalledWith(
        "stories/test-user-123/test-story-123/story.md"
      );

      // Verify episode generation
      expect(mockBedrockInstance.generateEpisode).toHaveBeenCalledWith(
        "Test story content",
        1
      );

      // Verify episode S3 upload
      expect(mockS3Operations.uploadText).toHaveBeenCalledWith(
        expect.stringContaining("episodes/test-user-123/test-story-123/1/"),
        "Episode 1 content with dialogue and scenes",
        "text/markdown"
      );

      // Verify database storage
      expect(mockEpisodeAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storyId: "test-story-123",
          episodeNumber: 1,
          status: "COMPLETED",
        })
      );

      // Verify image generation event published
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).toHaveBeenCalledWith(
        "test-user-123",
        expect.any(String), // episodeId
        expect.stringContaining("episodes/test-user-123/test-story-123/1/")
      );

      expect(result).toBeUndefined();
    });

    it("should handle episode generation failures", async () => {
      const event = EventBridgeEventFactory.createEpisodeGenerationEvent();

      const mockBedrockInstance = {
        generateEpisode: jest
          .fn()
          .mockRejectedValue(new Error("Episode generation failed")),
      };
      mockEpisodeBedrockClient.mockImplementation(
        () => mockBedrockInstance as any
      );

      await expect(
        episodeGenerationHandler(event, mockContext)
      ).rejects.toThrow("Episode generation failed");

      // Verify no image generation event published
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).not.toHaveBeenCalled();
    });
  });

  describe("Image Generation Event Flow", () => {
    it("should handle complete image generation workflow", async () => {
      const event = EventBridgeEventFactory.createImageGenerationEvent();

      const mockBedrockInstance = {
        generateImages: jest
          .fn()
          .mockResolvedValue([
            Buffer.from("image1-data"),
            Buffer.from("image2-data"),
          ]),
      };
      const mockPdfGenerator = {
        createPDF: jest.fn().mockResolvedValue(Buffer.from("pdf-data")),
      };
      mockImageBedrockClient.mockImplementation(
        () =>
          ({
            ...mockBedrockInstance,
            ...mockPdfGenerator,
          } as any)
      );

      const result = await imageGenerationHandler(event, mockContext);

      // Verify episode content fetched
      expect(mockS3Operations.getTextContent).toHaveBeenCalledWith(
        "episodes/test-user-123/test-story-123/1/episode.md"
      );

      // Verify image generation
      expect(mockBedrockInstance.generateImages).toHaveBeenCalledWith(
        "Test story content"
      );

      // Verify PDF creation
      expect(mockPdfGenerator.createPDF).toHaveBeenCalledWith(
        "Test story content",
        [Buffer.from("image1-data"), Buffer.from("image2-data")]
      );

      // Verify PDF S3 upload
      expect(mockS3Operations.uploadBuffer).toHaveBeenCalledWith(
        expect.stringContaining(
          "episodes/test-user-123/test-story-123/1/episode.pdf"
        ),
        Buffer.from("pdf-data"),
        "application/pdf"
      );

      // Verify episode updated with PDF reference
      expect(mockEpisodeAccess.updatePdfReference).toHaveBeenCalledWith(
        expect.any(String), // episodeId
        expect.stringContaining("episode.pdf")
      );

      expect(result).toBeUndefined();
    });

    it("should handle image generation failures", async () => {
      const event = EventBridgeEventFactory.createImageGenerationEvent();

      const mockBedrockInstance = {
        generateImages: jest
          .fn()
          .mockRejectedValue(new Error("Image generation failed")),
      };
      mockImageBedrockClient.mockImplementation(
        () => mockBedrockInstance as any
      );

      await expect(imageGenerationHandler(event, mockContext)).rejects.toThrow(
        "Image generation failed"
      );

      // Verify no PDF upload
      expect(mockS3Operations.uploadBuffer).not.toHaveBeenCalled();
    });
  });

  describe("End-to-End Event Chain", () => {
    it("should handle complete story-to-image generation chain", async () => {
      // Story generation event
      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent();

      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Test Adventure Story",
          content: "# Chapter 1\n\nOnce upon a time...",
          metadata: { wordCount: 1000 },
        }),
      };
      mockBedrockClient.mockImplementation(
        () => mockStoryBedrockInstance as any
      );

      // Execute story generation
      await storyGenerationHandler(storyEvent, mockContext);

      // Verify episode generation event was published
      expect(
        mockEventPublishingHelpers.publishEpisodeGeneration
      ).toHaveBeenCalled();
      const episodeEventCall =
        mockEventPublishingHelpers.publishEpisodeGeneration.mock.calls[0];

      // Simulate episode generation event
      const episodeEvent = EventBridgeEventFactory.createEpisodeGenerationEvent(
        episodeEventCall[0], // userId
        episodeEventCall[1] // storyId
      );

      const mockEpisodeBedrockInstance = {
        generateEpisode: jest.fn().mockResolvedValue({
          content: "Episode 1 content",
          metadata: { wordCount: 500 },
        }),
      };
      mockEpisodeBedrockClient.mockImplementation(
        () => mockEpisodeBedrockInstance as any
      );

      // Execute episode generation
      await episodeGenerationHandler(episodeEvent, mockContext);

      // Verify image generation event was published
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).toHaveBeenCalled();
      const imageEventCall =
        mockEventPublishingHelpers.publishImageGeneration.mock.calls[0];

      // Simulate image generation event
      const imageEvent = EventBridgeEventFactory.createImageGenerationEvent(
        imageEventCall[0], // userId
        imageEventCall[1] // episodeId
      );

      const mockImageBedrockInstance = {
        generateImages: jest
          .fn()
          .mockResolvedValue([Buffer.from("image-data")]),
      };
      const mockPdfGenerator = {
        createPDF: jest.fn().mockResolvedValue(Buffer.from("pdf-data")),
      };
      mockImageBedrockClient.mockImplementation(
        () =>
          ({
            ...mockImageBedrockInstance,
            ...mockPdfGenerator,
          } as any)
      );

      // Execute image generation
      await imageGenerationHandler(imageEvent, mockContext);

      // Verify complete workflow
      expect(mockStoryAccess.create).toHaveBeenCalled();
      expect(mockEpisodeAccess.create).toHaveBeenCalled();
      expect(mockS3Operations.uploadText).toHaveBeenCalledTimes(2); // Story + Episode
      expect(mockS3Operations.uploadBuffer).toHaveBeenCalledTimes(1); // PDF
    });

    it("should handle partial failures in event chain", async () => {
      // Story generation succeeds
      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent();

      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Test Story",
          content: "Story content",
          metadata: { wordCount: 1000 },
        }),
      };
      mockBedrockClient.mockImplementation(
        () => mockStoryBedrockInstance as any
      );

      await storyGenerationHandler(storyEvent, mockContext);

      // Episode generation fails
      const episodeEvent =
        EventBridgeEventFactory.createEpisodeGenerationEvent();

      const mockEpisodeBedrockInstance = {
        generateEpisode: jest
          .fn()
          .mockRejectedValue(new Error("Episode failed")),
      };
      mockEpisodeBedrockClient.mockImplementation(
        () => mockEpisodeBedrockInstance as any
      );

      await expect(
        episodeGenerationHandler(episodeEvent, mockContext)
      ).rejects.toThrow("Episode failed");

      // Verify story was created but episode was not
      expect(mockStoryAccess.create).toHaveBeenCalled();
      expect(mockEpisodeAccess.create).not.toHaveBeenCalled();

      // Verify no image generation event published
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).not.toHaveBeenCalled();
    });
  });

  describe("Event Validation", () => {
    it("should validate story generation event structure", async () => {
      const invalidEvent = {
        ...EventBridgeEventFactory.createStoryGenerationEvent(),
        detail: {
          // Missing required fields
          userId: "test-user-123",
        },
      };

      await expect(
        storyGenerationHandler(invalidEvent as any, mockContext)
      ).rejects.toThrow();
    });

    it("should validate episode generation event structure", async () => {
      const invalidEvent = {
        ...EventBridgeEventFactory.createEpisodeGenerationEvent(),
        detail: {
          // Missing required fields
          userId: "test-user-123",
        },
      };

      await expect(
        episodeGenerationHandler(invalidEvent as any, mockContext)
      ).rejects.toThrow();
    });

    it("should validate image generation event structure", async () => {
      const invalidEvent = {
        ...EventBridgeEventFactory.createImageGenerationEvent(),
        detail: {
          // Missing required fields
          userId: "test-user-123",
        },
      };

      await expect(
        imageGenerationHandler(invalidEvent as any, mockContext)
      ).rejects.toThrow();
    });
  });

  describe("Error Recovery", () => {
    it("should handle retry scenarios for transient failures", async () => {
      const event = EventBridgeEventFactory.createStoryGenerationEvent();

      const mockBedrockInstance = {
        generateStory: jest
          .fn()
          .mockRejectedValueOnce(new Error("Temporary failure"))
          .mockResolvedValue({
            title: "Test Story",
            content: "Story content",
            metadata: { wordCount: 1000 },
          }),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      // First attempt should fail and be retried
      await expect(storyGenerationHandler(event, mockContext)).rejects.toThrow(
        "Temporary failure"
      );

      // Second attempt should succeed
      await storyGenerationHandler(event, mockContext);

      expect(mockBedrockInstance.generateStory).toHaveBeenCalledTimes(2);
      expect(mockStoryAccess.create).toHaveBeenCalledTimes(1); // Only on success
    });
  });

  describe("Performance Monitoring", () => {
    it("should complete story generation within time limits", async () => {
      const event = EventBridgeEventFactory.createStoryGenerationEvent();

      const mockBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Test Story",
          content: "Story content",
          metadata: { wordCount: 1000 },
        }),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      const start = Date.now();
      await storyGenerationHandler(event, mockContext);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds for mocked operations
    });

    it("should complete episode generation within time limits", async () => {
      const event = EventBridgeEventFactory.createEpisodeGenerationEvent();

      const mockBedrockInstance = {
        generateEpisode: jest.fn().mockResolvedValue({
          content: "Episode content",
          metadata: { wordCount: 500 },
        }),
      };
      mockEpisodeBedrockClient.mockImplementation(
        () => mockBedrockInstance as any
      );

      const start = Date.now();
      await episodeGenerationHandler(event, mockContext);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds for mocked operations
    });
  });
});
