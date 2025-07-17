import { handler } from "../index";
import { EpisodeGenerationEventDetail } from "../../../types/event-schemas";
import {
  StoryAccess,
  EpisodeAccess,
  GenerationRequestAccess,
} from "../../../database/access-patterns";
import { EventPublishingHelpers } from "../../../utils/event-publisher";
import { createMangaStorageService } from "../../../storage/manga-storage";
import { BedrockClient } from "../bedrock-client";
import { EventBridgeEvent } from "aws-lambda";

// Mock dependencies
jest.mock("../../../database/access-patterns");
jest.mock("../../../utils/event-publisher");
jest.mock("../../../storage/manga-storage");
jest.mock("../bedrock-client");

const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockEventPublishingHelpers = EventPublishingHelpers as jest.Mocked<
  typeof EventPublishingHelpers
>;
const mockCreateMangaStorageService =
  createMangaStorageService as jest.MockedFunction<
    typeof createMangaStorageService
  >;
const mockBedrockClient = BedrockClient as jest.MockedClass<
  typeof BedrockClient
>;

describe("Episode Generation Lambda", () => {
  const mockEvent: EventBridgeEvent<
    "Episode Generation Requested",
    EpisodeGenerationEventDetail
  > = {
    version: "0",
    id: "test-event-id",
    "detail-type": "Episode Generation Requested",
    source: "manga.story",
    account: "123456789012",
    time: "2023-01-01T00:00:00Z",
    region: "us-east-1",
    resources: [],
    detail: {
      userId: "user-123",
      storyId: "story-456",
      storyS3Key: "stories/user-123/story-456/story.md",
      episodeNumber: 1,
      timestamp: "2023-01-01T00:00:00Z",
    },
  };

  const mockStory = {
    PK: "USER#user-123",
    SK: "STORY#story-456",
    GSI1PK: "STORY#story-456",
    GSI1SK: "METADATA",
    GSI2PK: "STATUS#COMPLETED",
    GSI2SK: "2023-01-01T00:00:00Z",
    storyId: "story-456",
    userId: "user-123",
    title: "Test Story",
    s3Key: "stories/user-123/story-456/story.md",
    status: "COMPLETED" as const,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  };

  const mockStorageService = {
    getStory: jest.fn(),
    saveEpisode: jest.fn(),
  };

  const mockBedrockInstance = {
    generateEpisode: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateMangaStorageService.mockReturnValue(mockStorageService as any);
    mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);
  });

  describe("Successful episode generation", () => {
    it("should generate episode successfully", async () => {
      // Setup mocks
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.get.mockResolvedValue(null); // No existing episode
      mockEpisodeAccess.create.mockResolvedValue();
      mockEpisodeAccess.updateStatus.mockResolvedValue();

      mockStorageService.getStory.mockResolvedValue(
        "# Test Story\n\nThis is a test story content."
      );

      mockBedrockInstance.generateEpisode.mockResolvedValue({
        content: "# Episode 1: The Beginning\n\nThis is episode 1 content.",
        usage: {
          inputTokens: 100,
          outputTokens: 200,
        },
      });

      mockStorageService.saveEpisode.mockResolvedValue({
        bucket: "test-bucket",
        key: "episodes/user-123/story-456/1/episode.md",
      });

      mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
      mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

      // Execute
      await handler(mockEvent);

      // Verify story lookup
      expect(mockStoryAccess.getByStoryId).toHaveBeenCalledWith("story-456");

      // Verify episode creation
      expect(mockEpisodeAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeNumber: 1,
          storyId: "story-456",
          status: "PROCESSING",
        })
      );

      // Verify story content fetch
      expect(mockStorageService.getStory).toHaveBeenCalledWith(
        "user-123",
        "story-456"
      );

      // Verify Bedrock episode generation
      expect(mockBedrockInstance.generateEpisode).toHaveBeenCalledWith(
        "# Test Story\n\nThis is a test story content.",
        1,
        "Test Story"
      );

      // Verify episode save
      expect(mockStorageService.saveEpisode).toHaveBeenCalledWith(
        "user-123",
        "story-456",
        expect.objectContaining({
          episodeNumber: 1,
          title: "Episode 1: The Beginning",
          content: "This is episode 1 content.",
          storyId: "story-456",
        })
      );

      // Verify episode status update
      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-456",
        1,
        "COMPLETED",
        expect.objectContaining({
          s3Key: "episodes/user-123/story-456/1/episode.md",
          title: "Episode 1: The Beginning",
        })
      );

      // Verify image generation event
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).toHaveBeenCalledWith(
        "user-123",
        expect.any(String), // episodeId (UUID)
        "episodes/user-123/story-456/1/episode.md"
      );

      // Verify status update event
      expect(
        mockEventPublishingHelpers.publishStatusUpdate
      ).toHaveBeenCalledWith(
        "user-123",
        "user-123",
        "EPISODE",
        "COMPLETED",
        expect.any(String)
      );
    });

    it("should handle existing completed episode", async () => {
      const existingEpisode = {
        PK: "STORY#story-456",
        SK: "EPISODE#001",
        GSI1PK: "EPISODE#episode-789",
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2023-01-01T00:00:00Z",
        episodeId: "episode-789",
        episodeNumber: 1,
        storyId: "story-456",
        s3Key: "episodes/user-123/story-456/1/episode.md",
        status: "COMPLETED" as const,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      };

      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.get.mockResolvedValue(existingEpisode);
      mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();

      await handler(mockEvent);

      // Should not create new episode
      expect(mockEpisodeAccess.create).not.toHaveBeenCalled();

      // Should publish image generation for existing episode
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).toHaveBeenCalledWith(
        "user-123",
        "episode-789",
        "episodes/user-123/story-456/1/episode.md"
      );
    });
  });

  describe("Input validation", () => {
    it("should throw error for missing userId", async () => {
      const invalidEvent = {
        ...mockEvent,
        detail: { ...mockEvent.detail, userId: "" },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "User ID is required and cannot be empty"
      );
    });

    it("should throw error for missing storyId", async () => {
      const invalidEvent = {
        ...mockEvent,
        detail: { ...mockEvent.detail, storyId: "" },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "Story ID is required and cannot be empty"
      );
    });

    it("should throw error for missing storyS3Key", async () => {
      const invalidEvent = {
        ...mockEvent,
        detail: { ...mockEvent.detail, storyS3Key: "" },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "Story S3 key is required and cannot be empty"
      );
    });

    it("should throw error for invalid episode number", async () => {
      const invalidEvent = {
        ...mockEvent,
        detail: { ...mockEvent.detail, episodeNumber: 0 },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "Episode number must be a positive integer"
      );
    });
  });

  describe("Error handling", () => {
    it("should handle story not found", async () => {
      mockStoryAccess.getByStoryId.mockResolvedValue(null);

      await expect(handler(mockEvent)).rejects.toThrow(
        "Story not found: story-456"
      );
    });

    it("should handle story not completed", async () => {
      const incompleteStory = { ...mockStory, status: "PROCESSING" as const };
      mockStoryAccess.getByStoryId.mockResolvedValue(incompleteStory);

      await expect(handler(mockEvent)).rejects.toThrow(
        "Story is not completed. Current status: PROCESSING"
      );
    });

    it("should handle empty story content", async () => {
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.get.mockResolvedValue(null);
      mockEpisodeAccess.create.mockResolvedValue();
      mockStorageService.getStory.mockResolvedValue("");

      await expect(handler(mockEvent)).rejects.toThrow(
        "Story content is empty or not found in S3"
      );
    });

    it("should handle Bedrock generation failure", async () => {
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.get.mockResolvedValue(null);
      mockEpisodeAccess.create.mockResolvedValue();
      mockStorageService.getStory.mockResolvedValue("Test story content");
      mockBedrockInstance.generateEpisode.mockRejectedValue(
        new Error("Bedrock error")
      );

      // Mock cleanup operations
      mockEpisodeAccess.get.mockResolvedValue({
        PK: "STORY#story-456",
        SK: "EPISODE#001",
        GSI1PK: "EPISODE#episode-123",
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2023-01-01T00:00:00Z",
        episodeId: "episode-123",
        episodeNumber: 1,
        storyId: "story-456",
        s3Key: "",
        status: "PROCESSING" as const,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      });
      mockEpisodeAccess.updateStatus.mockResolvedValue();
      mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

      await expect(handler(mockEvent)).rejects.toThrow("Bedrock error");

      // Verify cleanup operations
      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-456",
        1,
        "FAILED",
        expect.objectContaining({
          errorMessage: "Bedrock error",
        })
      );

      expect(
        mockEventPublishingHelpers.publishStatusUpdate
      ).toHaveBeenCalledWith(
        "user-123",
        "story-456",
        "EPISODE",
        "FAILED",
        expect.any(String),
        "Bedrock error"
      );
    });

    it("should handle S3 save failure", async () => {
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.get.mockResolvedValue(null);
      mockEpisodeAccess.create.mockResolvedValue();
      mockStorageService.getStory.mockResolvedValue("Test story content");
      mockBedrockInstance.generateEpisode.mockResolvedValue({
        content: "Episode content",
        usage: { inputTokens: 100, outputTokens: 200 },
      });
      mockStorageService.saveEpisode.mockRejectedValue(
        new Error("S3 save error")
      );

      // Mock cleanup operations
      mockEpisodeAccess.get.mockResolvedValue({
        PK: "STORY#story-456",
        SK: "EPISODE#001",
        GSI1PK: "EPISODE#episode-123",
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2023-01-01T00:00:00Z",
        episodeId: "episode-123",
        episodeNumber: 1,
        storyId: "story-456",
        s3Key: "",
        status: "PROCESSING" as const,
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      });
      mockEpisodeAccess.updateStatus.mockResolvedValue();
      mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

      await expect(handler(mockEvent)).rejects.toThrow("S3 save error");

      // Verify cleanup operations
      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-456",
        1,
        "FAILED",
        expect.objectContaining({
          errorMessage: "S3 save error",
        })
      );
    });
  });

  describe("Content parsing", () => {
    it("should parse episode title from markdown header", async () => {
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.get.mockResolvedValue(null);
      mockEpisodeAccess.create.mockResolvedValue();
      mockEpisodeAccess.updateStatus.mockResolvedValue();
      mockStorageService.getStory.mockResolvedValue("Test story content");

      mockBedrockInstance.generateEpisode.mockResolvedValue({
        content: "# The Great Adventure\n\nThis is the episode content.",
        usage: { inputTokens: 100, outputTokens: 200 },
      });

      mockStorageService.saveEpisode.mockResolvedValue({
        bucket: "test-bucket",
        key: "episodes/user-123/story-456/1/episode.md",
      });

      mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
      mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

      await handler(mockEvent);

      expect(mockStorageService.saveEpisode).toHaveBeenCalledWith(
        "user-123",
        "story-456",
        expect.objectContaining({
          title: "The Great Adventure",
          content: "This is the episode content.",
        })
      );
    });

    it("should parse episode title from Episode X: format", async () => {
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.get.mockResolvedValue(null);
      mockEpisodeAccess.create.mockResolvedValue();
      mockEpisodeAccess.updateStatus.mockResolvedValue();
      mockStorageService.getStory.mockResolvedValue("Test story content");

      mockBedrockInstance.generateEpisode.mockResolvedValue({
        content: "Episode 1: The Beginning\n\nThis is the episode content.",
        usage: { inputTokens: 100, outputTokens: 200 },
      });

      mockStorageService.saveEpisode.mockResolvedValue({
        bucket: "test-bucket",
        key: "episodes/user-123/story-456/1/episode.md",
      });

      mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
      mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

      await handler(mockEvent);

      expect(mockStorageService.saveEpisode).toHaveBeenCalledWith(
        "user-123",
        "story-456",
        expect.objectContaining({
          title: "Episode 1: The Beginning",
          content: "This is the episode content.",
        })
      );
    });

    it("should use default title when no title found", async () => {
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.get.mockResolvedValue(null);
      mockEpisodeAccess.create.mockResolvedValue();
      mockEpisodeAccess.updateStatus.mockResolvedValue();
      mockStorageService.getStory.mockResolvedValue("Test story content");

      mockBedrockInstance.generateEpisode.mockResolvedValue({
        content: "This is just episode content without a title.",
        usage: { inputTokens: 100, outputTokens: 200 },
      });

      mockStorageService.saveEpisode.mockResolvedValue({
        bucket: "test-bucket",
        key: "episodes/user-123/story-456/1/episode.md",
      });

      mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
      mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

      await handler(mockEvent);

      expect(mockStorageService.saveEpisode).toHaveBeenCalledWith(
        "user-123",
        "story-456",
        expect.objectContaining({
          title: "Episode 1",
          content: "This is just episode content without a title.",
        })
      );
    });
  });
});
