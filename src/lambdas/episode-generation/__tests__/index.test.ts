import { handler } from "../index";
import {
  EpisodeGenerationEventDetail,
  ContinueEpisodeEventDetail,
} from "../../../types/event-schemas";
import {
  StoryAccess,
  EpisodeAccess,
  GenerationRequestAccess,
  UserPreferencesAccess,
} from "../../../database/access-patterns";
import { EventPublishingHelpers } from "../../../utils/event-publisher";
import { createMangaStorageService } from "../../../storage/manga-storage";
import { BedrockClient } from "../bedrock-client";
import { EventBridgeEvent } from "aws-lambda";
import { UserPreferencesData } from "../../../types/data-models";

// Mock dependencies
jest.mock("../../../database/access-patterns");
jest.mock("../../../utils/event-publisher");
jest.mock("../../../storage/manga-storage");
jest.mock("../bedrock-client");

const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
>;
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
    generateEpisodeWithPreferences: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateMangaStorageService.mockReturnValue(mockStorageService as any);
    mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

    // Default mock for user preferences (can be overridden in specific tests)
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: null,
    });
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

  describe("Continue Episode Events", () => {
    const mockUserPreferences: UserPreferencesData = {
      genres: ["Action", "Adventure"],
      themes: ["Friendship", "Growth"],
      artStyle: "Manga",
      targetAudience: "Teen",
      contentRating: "PG-13",
    };

    const mockContinueEpisodeEvent: EventBridgeEvent<
      "Continue Episode Requested",
      ContinueEpisodeEventDetail
    > = {
      version: "0",
      id: "test-continue-event-id",
      "detail-type": "Continue Episode Requested",
      source: "manga.story",
      account: "123456789012",
      time: "2023-01-01T00:00:00Z",
      region: "us-east-1",
      resources: [],
      detail: {
        userId: "user-123",
        storyId: "story-456",
        nextEpisodeNumber: 2,
        originalPreferences: mockUserPreferences,
        storyS3Key: "stories/user-123/story-456/story.md",
        timestamp: "2023-01-01T00:00:00Z",
      },
    };

    const mockExistingEpisode = {
      PK: "STORY#story-456",
      SK: "EPISODE#001",
      GSI1PK: "EPISODE#episode-001",
      GSI1SK: "METADATA",
      GSI2PK: "STATUS#COMPLETED",
      GSI2SK: "2023-01-01T00:00:00Z",
      episodeId: "episode-001",
      episodeNumber: 1,
      storyId: "story-456",
      s3Key: "episodes/user-123/story-456/1/episode.md",
      status: "COMPLETED" as const,
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    };

    it("should generate continue episode successfully", async () => {
      // Setup mocks
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
        mockExistingEpisode,
      ]);
      mockEpisodeAccess.get.mockResolvedValue(null); // No existing episode 2
      mockEpisodeAccess.create.mockResolvedValue();
      mockEpisodeAccess.updateStatus.mockResolvedValue();

      mockStorageService.getStory.mockResolvedValue(
        "# Test Story\n\nThis is a test story content."
      );

      mockBedrockInstance.generateEpisodeWithPreferences.mockResolvedValue({
        content:
          "# Episode 2: The Journey Continues\n\nThis is episode 2 content with preferences.",
        usage: {
          inputTokens: 150,
          outputTokens: 250,
        },
      });

      mockStorageService.saveEpisode.mockResolvedValue({
        bucket: "test-bucket",
        key: "episodes/user-123/story-456/2/episode.md",
      });

      mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
      mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

      // Execute
      await handler(mockContinueEpisodeEvent);

      // Verify story lookup
      expect(mockStoryAccess.getByStoryId).toHaveBeenCalledWith("story-456");

      // Verify episode numbering validation
      expect(mockEpisodeAccess.getStoryEpisodes).toHaveBeenCalledWith(
        "story-456"
      );

      // Verify episode creation
      expect(mockEpisodeAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeNumber: 2,
          storyId: "story-456",
          status: "PROCESSING",
        })
      );

      // Verify story content fetch
      expect(mockStorageService.getStory).toHaveBeenCalledWith(
        "user-123",
        "story-456"
      );

      // Verify Bedrock episode generation with preferences
      expect(
        mockBedrockInstance.generateEpisodeWithPreferences
      ).toHaveBeenCalledWith(
        "# Test Story\n\nThis is a test story content.",
        2,
        "Test Story",
        mockUserPreferences
      );

      // Verify episode save with continue episode metadata
      expect(mockStorageService.saveEpisode).toHaveBeenCalledWith(
        "user-123",
        "story-456",
        expect.objectContaining({
          episodeNumber: 2,
          title: "Episode 2: The Journey Continues",
          content: "This is episode 2 content with preferences.",
          storyId: "story-456",
          metadata: expect.objectContaining({
            isContinueEpisode: true,
            hasPreferencesContext: true,
          }),
        })
      );

      // Verify episode status update with continue episode flag
      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-456",
        2,
        "COMPLETED",
        expect.objectContaining({
          s3Key: "episodes/user-123/story-456/2/episode.md",
          title: "Episode 2: The Journey Continues",
          isContinueEpisode: true,
        })
      );

      // Verify image generation event
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).toHaveBeenCalledWith(
        "user-123",
        expect.any(String), // episodeId (UUID)
        "episodes/user-123/story-456/2/episode.md"
      );
    });

    it("should validate episode numbering for continue episodes", async () => {
      // Setup existing episodes (1 and 2)
      const existingEpisodes = [
        mockExistingEpisode,
        { ...mockExistingEpisode, episodeNumber: 2, SK: "EPISODE#002" },
      ];

      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue(existingEpisodes);

      // Try to create episode 4 (should be 3)
      const invalidEvent = {
        ...mockContinueEpisodeEvent,
        detail: { ...mockContinueEpisodeEvent.detail, nextEpisodeNumber: 4 },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "Invalid episode number for continuation. Expected 3, got 4"
      );

      expect(mockEpisodeAccess.getStoryEpisodes).toHaveBeenCalledWith(
        "story-456"
      );
    });

    it("should handle continue episode with no existing episodes", async () => {
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([]); // No existing episodes
      mockEpisodeAccess.get.mockResolvedValue(null);
      mockEpisodeAccess.create.mockResolvedValue();
      mockEpisodeAccess.updateStatus.mockResolvedValue();

      mockStorageService.getStory.mockResolvedValue("Test story content");
      mockBedrockInstance.generateEpisodeWithPreferences.mockResolvedValue({
        content: "# Episode 1: New Beginning\n\nFirst episode content.",
        usage: { inputTokens: 100, outputTokens: 200 },
      });

      mockStorageService.saveEpisode.mockResolvedValue({
        bucket: "test-bucket",
        key: "episodes/user-123/story-456/1/episode.md",
      });

      mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
      mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

      // Try to create episode 1 when no episodes exist
      const firstEpisodeEvent = {
        ...mockContinueEpisodeEvent,
        detail: { ...mockContinueEpisodeEvent.detail, nextEpisodeNumber: 1 },
      };

      await handler(firstEpisodeEvent);

      // Should succeed since 1 is the next episode after 0 existing episodes
      expect(mockEpisodeAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeNumber: 1,
          storyId: "story-456",
          status: "PROCESSING",
        })
      );
    });

    describe("Continue Episode Input Validation", () => {
      it("should throw error for missing userId in continue episode", async () => {
        const invalidEvent = {
          ...mockContinueEpisodeEvent,
          detail: { ...mockContinueEpisodeEvent.detail, userId: "" },
        };

        await expect(handler(invalidEvent)).rejects.toThrow(
          "User ID is required and cannot be empty"
        );
      });

      it("should throw error for missing storyId in continue episode", async () => {
        const invalidEvent = {
          ...mockContinueEpisodeEvent,
          detail: { ...mockContinueEpisodeEvent.detail, storyId: "" },
        };

        await expect(handler(invalidEvent)).rejects.toThrow(
          "Story ID is required and cannot be empty"
        );
      });

      it("should throw error for missing storyS3Key in continue episode", async () => {
        const invalidEvent = {
          ...mockContinueEpisodeEvent,
          detail: { ...mockContinueEpisodeEvent.detail, storyS3Key: "" },
        };

        await expect(handler(invalidEvent)).rejects.toThrow(
          "Story S3 key is required and cannot be empty"
        );
      });

      it("should throw error for invalid next episode number", async () => {
        const invalidEvent = {
          ...mockContinueEpisodeEvent,
          detail: { ...mockContinueEpisodeEvent.detail, nextEpisodeNumber: 0 },
        };

        await expect(handler(invalidEvent)).rejects.toThrow(
          "Next episode number must be a positive integer"
        );
      });

      it("should throw error for missing original preferences", async () => {
        const invalidEvent = {
          ...mockContinueEpisodeEvent,
          detail: {
            ...mockContinueEpisodeEvent.detail,
            originalPreferences: undefined as any,
          },
        };

        await expect(handler(invalidEvent)).rejects.toThrow(
          "Original preferences are required for continue episode events"
        );
      });
    });

    describe("Continue Episode Error Handling", () => {
      it("should handle Bedrock generation failure for continue episode", async () => {
        mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
        mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
          mockExistingEpisode,
        ]);
        mockEpisodeAccess.get.mockResolvedValue(null);
        mockEpisodeAccess.create.mockResolvedValue();
        mockStorageService.getStory.mockResolvedValue("Test story content");
        mockBedrockInstance.generateEpisodeWithPreferences.mockRejectedValue(
          new Error("Bedrock preferences error")
        );

        // Mock cleanup operations
        mockEpisodeAccess.get.mockResolvedValue({
          PK: "STORY#story-456",
          SK: "EPISODE#002",
          GSI1PK: "EPISODE#episode-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#PROCESSING",
          GSI2SK: "2023-01-01T00:00:00Z",
          episodeId: "episode-123",
          episodeNumber: 2,
          storyId: "story-456",
          s3Key: "",
          status: "PROCESSING" as const,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:00:00Z",
        });
        mockEpisodeAccess.updateStatus.mockResolvedValue();
        mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

        await expect(handler(mockContinueEpisodeEvent)).rejects.toThrow(
          "Bedrock preferences error"
        );

        // Verify cleanup operations
        expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
          "story-456",
          2,
          "FAILED",
          expect.objectContaining({
            errorMessage: "Bedrock preferences error",
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
          "Bedrock preferences error"
        );
      });

      it("should handle existing completed continue episode", async () => {
        const existingEpisode2 = {
          PK: "STORY#story-456",
          SK: "EPISODE#002",
          GSI1PK: "EPISODE#episode-002",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#COMPLETED",
          GSI2SK: "2023-01-01T00:00:00Z",
          episodeId: "episode-002",
          episodeNumber: 2,
          storyId: "story-456",
          s3Key: "episodes/user-123/story-456/2/episode.md",
          status: "COMPLETED" as const,
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:00:00Z",
        };

        mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
        mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
          mockExistingEpisode,
        ]);
        mockEpisodeAccess.get.mockResolvedValue(existingEpisode2);
        mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();

        await handler(mockContinueEpisodeEvent);

        // Should not create new episode
        expect(mockEpisodeAccess.create).not.toHaveBeenCalled();

        // Should publish image generation for existing episode
        expect(
          mockEventPublishingHelpers.publishImageGeneration
        ).toHaveBeenCalledWith(
          "user-123",
          "episode-002",
          "episodes/user-123/story-456/2/episode.md"
        );
      });
    });

    describe("Regular Episode with Preferences Fallback", () => {
      it("should fetch user preferences for regular episodes when not provided", async () => {
        // Setup mocks for regular episode without preferences
        mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
        mockEpisodeAccess.get.mockResolvedValue(null);
        mockEpisodeAccess.create.mockResolvedValue();
        mockEpisodeAccess.updateStatus.mockResolvedValue();

        // Mock user preferences fetch
        mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
          preferences: mockUserPreferences,
          insights: undefined,
          lastUpdated: "2023-01-01T00:00:00Z",
        });

        mockStorageService.getStory.mockResolvedValue("Test story content");

        mockBedrockInstance.generateEpisodeWithPreferences.mockResolvedValue({
          content:
            "# Episode 1: With Fetched Preferences\n\nContent with preferences.",
          usage: { inputTokens: 100, outputTokens: 200 },
        });

        mockStorageService.saveEpisode.mockResolvedValue({
          bucket: "test-bucket",
          key: "episodes/user-123/story-456/1/episode.md",
        });

        mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
        mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

        await handler(mockEvent);

        // Verify preferences were fetched
        expect(
          mockUserPreferencesAccess.getLatestWithMetadata
        ).toHaveBeenCalledWith("user-123");

        // Verify Bedrock was called with preferences
        expect(
          mockBedrockInstance.generateEpisodeWithPreferences
        ).toHaveBeenCalledWith(
          "Test story content",
          1,
          "Test Story",
          mockUserPreferences
        );

        // Verify episode metadata includes preferences context
        expect(mockStorageService.saveEpisode).toHaveBeenCalledWith(
          "user-123",
          "story-456",
          expect.objectContaining({
            metadata: expect.objectContaining({
              isContinueEpisode: false,
              hasPreferencesContext: true,
            }),
          })
        );
      });

      it("should handle regular episode when no user preferences found", async () => {
        mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
        mockEpisodeAccess.get.mockResolvedValue(null);
        mockEpisodeAccess.create.mockResolvedValue();
        mockEpisodeAccess.updateStatus.mockResolvedValue();

        // Mock no user preferences found
        mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
          preferences: null,
        });

        mockStorageService.getStory.mockResolvedValue("Test story content");

        mockBedrockInstance.generateEpisode.mockResolvedValue({
          content:
            "# Episode 1: Without Preferences\n\nContent without preferences.",
          usage: { inputTokens: 100, outputTokens: 200 },
        });

        mockStorageService.saveEpisode.mockResolvedValue({
          bucket: "test-bucket",
          key: "episodes/user-123/story-456/1/episode.md",
        });

        mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();
        mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

        await handler(mockEvent);

        // Verify preferences were attempted to be fetched
        expect(
          mockUserPreferencesAccess.getLatestWithMetadata
        ).toHaveBeenCalledWith("user-123");

        // Verify Bedrock was called without preferences (fallback to regular method)
        expect(mockBedrockInstance.generateEpisode).toHaveBeenCalledWith(
          "Test story content",
          1,
          "Test Story"
        );

        // Verify episode metadata reflects no preferences context
        expect(mockStorageService.saveEpisode).toHaveBeenCalledWith(
          "user-123",
          "story-456",
          expect.objectContaining({
            metadata: expect.objectContaining({
              isContinueEpisode: false,
              hasPreferencesContext: false,
            }),
          })
        );
      });
    });
  });
});
