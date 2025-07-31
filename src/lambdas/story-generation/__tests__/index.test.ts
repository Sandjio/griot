import { handler } from "../index";
import { BedrockClient } from "../bedrock-client";
import {
  StoryAccess,
  GenerationRequestAccess,
  UserPreferencesAccess,
} from "../../../database/access-patterns";
import { EventPublishingHelpers } from "../../../utils/event-publisher";
import { createMangaStorageService } from "../../../storage/manga-storage";
import { EventBridgeEvent } from "aws-lambda";
import {
  StoryGenerationEventDetail,
  BatchWorkflowEventDetail,
} from "../../../types/event-schemas";

// Mock all dependencies
jest.mock("../bedrock-client");
jest.mock("../../../database/access-patterns");
jest.mock("../../../utils/event-publisher");
jest.mock("../../../storage/manga-storage");
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-story-id-123"),
}));

const mockBedrockClient = BedrockClient as jest.MockedClass<
  typeof BedrockClient
>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
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

describe("Story Generation Lambda", () => {
  const mockEvent: EventBridgeEvent<
    "Story Generation Requested",
    StoryGenerationEventDetail
  > = {
    version: "0",
    id: "test-event-id",
    "detail-type": "Story Generation Requested",
    source: "manga.preferences",
    account: "123456789012",
    time: "2024-01-01T00:00:00Z",
    region: "us-east-1",
    resources: [],
    detail: {
      userId: "test-user-123",
      requestId: "test-request-456",
      preferences: {
        genres: ["Action", "Adventure"],
        themes: ["Friendship", "Growth"],
        artStyle: "Shonen",
        targetAudience: "Teen",
        contentRating: "PG-13",
      },
      insights: {
        recommendations: [
          { category: "Action", score: 0.9, attributes: {} },
          { category: "Adventure", score: 0.8, attributes: {} },
        ],
        trends: [
          { topic: "Friendship", popularity: 0.95 },
          { topic: "Growth", popularity: 0.85 },
        ],
      },
      timestamp: "2024-01-01T00:00:00Z",
    },
  };

  const mockStorageService = {
    saveStory: jest.fn(),
    getStory: jest.fn(),
    storyExists: jest.fn(),
  };

  const mockBedrockInstance = {
    generateStory: jest.fn(),
    generateStoryWithRetry: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockCreateMangaStorageService.mockReturnValue(mockStorageService as any);
    mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

    // Mock successful responses by default
    mockGenerationRequestAccess.updateStatus.mockResolvedValue();
    mockStoryAccess.create.mockResolvedValue();
    mockStoryAccess.get.mockResolvedValue(null);
    mockEventPublishingHelpers.publishEpisodeGeneration.mockResolvedValue();
    mockEventPublishingHelpers.publishStatusUpdate.mockResolvedValue();

    mockBedrockInstance.generateStory.mockResolvedValue({
      content:
        "# The Adventure Begins\n\nThis is a test story about friendship and growth...",
      usage: {
        inputTokens: 100,
        outputTokens: 200,
      },
    });

    mockStorageService.saveStory.mockResolvedValue({
      bucket: "test-bucket",
      key: "stories/test-user-123/test-story-id-123/story.md",
      url: "https://test-bucket.s3.amazonaws.com/stories/test-user-123/test-story-id-123/story.md",
    });
  });

  describe("Successful story generation", () => {
    it("should successfully generate and save a story", async () => {
      await handler(mockEvent);

      // Verify generation request status updates
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "PROCESSING",
        { relatedEntityId: "test-story-id-123" }
      );

      // Verify Bedrock story generation
      expect(mockBedrockInstance.generateStory).toHaveBeenCalledWith(
        mockEvent.detail.preferences,
        mockEvent.detail.insights
      );

      // Verify story storage
      expect(mockStorageService.saveStory).toHaveBeenCalledWith(
        "test-user-123",
        "test-story-id-123",
        expect.objectContaining({
          title: "The Adventure Begins",
          content: "This is a test story about friendship and growth...",
          metadata: expect.objectContaining({
            storyId: "test-story-id-123",
            userId: "test-user-123",
            requestId: "test-request-456",
            tokensUsed: "300", // Changed to string to match implementation
          }),
        })
      );

      // Verify DynamoDB story metadata storage
      expect(mockStoryAccess.create).toHaveBeenCalledWith({
        storyId: "test-story-id-123",
        userId: "test-user-123",
        title: "The Adventure Begins",
        s3Key: "stories/test-user-123/test-story-id-123/story.md",
        status: "COMPLETED",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      // Verify completion status update
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "COMPLETED",
        { relatedEntityId: "test-story-id-123" }
      );

      // Verify episode generation event
      expect(
        mockEventPublishingHelpers.publishEpisodeGeneration
      ).toHaveBeenCalledWith(
        "test-user-123",
        "test-story-id-123",
        "stories/test-user-123/test-story-id-123/story.md",
        1
      );

      // Verify status update event
      expect(
        mockEventPublishingHelpers.publishStatusUpdate
      ).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "STORY",
        "COMPLETED",
        "test-story-id-123"
      );
    });

    it("should handle story content without explicit title", async () => {
      mockBedrockInstance.generateStory.mockResolvedValue({
        content: "This is a story without a title marker...",
        usage: { inputTokens: 50, outputTokens: 100 },
      });

      await handler(mockEvent);

      expect(mockStorageService.saveStory).toHaveBeenCalledWith(
        "test-user-123",
        "test-story-id-123",
        expect.objectContaining({
          title: "Untitled Story",
          content: "This is a story without a title marker...",
        })
      );
    });

    it("should parse title from different formats", async () => {
      const testCases = [
        {
          content: "**Epic Adventure**\n\nThis is the story content...",
          expectedTitle: "Epic Adventure",
        },
        {
          content: "Title: My Great Story\n\nThis is the story content...",
          expectedTitle: "My Great Story",
        },
        {
          content: "# The Ultimate Quest\n\nThis is the story content...",
          expectedTitle: "The Ultimate Quest",
        },
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();
        mockBedrockInstance.generateStory.mockResolvedValue({
          content: testCase.content,
          usage: { inputTokens: 50, outputTokens: 100 },
        });

        await handler(mockEvent);

        expect(mockStorageService.saveStory).toHaveBeenCalledWith(
          "test-user-123",
          "test-story-id-123",
          expect.objectContaining({
            title: testCase.expectedTitle,
          })
        );
      }
    });
  });

  describe("Error handling", () => {
    it("should handle Bedrock generation errors", async () => {
      const bedrockError = new Error("Bedrock service unavailable");
      mockBedrockInstance.generateStory.mockRejectedValue(bedrockError);

      await expect(handler(mockEvent)).rejects.toThrow(
        "Bedrock service unavailable"
      );

      // Verify error handling
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "FAILED",
        {
          errorMessage: "Bedrock service unavailable",
          relatedEntityId: "test-story-id-123",
        }
      );

      expect(
        mockEventPublishingHelpers.publishStatusUpdate
      ).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "STORY",
        "FAILED",
        "test-story-id-123",
        "Bedrock service unavailable"
      );
    });

    it("should handle S3 storage errors", async () => {
      const s3Error = new Error("S3 bucket not accessible");
      mockStorageService.saveStory.mockRejectedValue(s3Error);

      await expect(handler(mockEvent)).rejects.toThrow(
        "S3 bucket not accessible"
      );

      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "FAILED",
        {
          errorMessage: "S3 bucket not accessible",
          relatedEntityId: "test-story-id-123",
        }
      );
    });

    it("should handle DynamoDB errors", async () => {
      const dynamoError = new Error("DynamoDB table not found");
      mockStoryAccess.create.mockRejectedValue(dynamoError);

      await expect(handler(mockEvent)).rejects.toThrow(
        "DynamoDB table not found"
      );

      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "FAILED",
        {
          errorMessage: "DynamoDB table not found",
          relatedEntityId: "test-story-id-123",
        }
      );
    });

    it("should handle EventBridge publishing errors", async () => {
      const eventError = new Error("EventBridge bus not found");
      mockEventPublishingHelpers.publishEpisodeGeneration.mockRejectedValue(
        eventError
      );

      await expect(handler(mockEvent)).rejects.toThrow(
        "EventBridge bus not found"
      );

      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-456",
        "FAILED",
        {
          errorMessage: "EventBridge bus not found",
          relatedEntityId: "test-story-id-123",
        }
      );
    });

    it("should handle cleanup errors gracefully", async () => {
      const originalError = new Error("Original processing error");
      const cleanupError = new Error("Cleanup failed");

      mockBedrockInstance.generateStory.mockRejectedValue(originalError);
      mockGenerationRequestAccess.updateStatus
        .mockResolvedValueOnce(undefined) // First call succeeds (PROCESSING status)
        .mockRejectedValueOnce(cleanupError); // Second call fails (FAILED status)

      // Should still throw the original error, not the cleanup error
      await expect(handler(mockEvent)).rejects.toThrow(
        "Original processing error"
      );
    });

    it("should update existing story status to failed when story exists", async () => {
      const existingStory = {
        storyId: "test-story-id-123",
        userId: "test-user-123",
        title: "Existing Story",
        status: "PROCESSING" as const,
      };

      mockStoryAccess.get.mockResolvedValue(existingStory as any);
      mockStoryAccess.updateStatus = jest.fn().mockResolvedValue(undefined);

      const processingError = new Error("Processing failed");
      mockBedrockInstance.generateStory.mockRejectedValue(processingError);

      await expect(handler(mockEvent)).rejects.toThrow("Processing failed");

      expect(mockStoryAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-story-id-123",
        "FAILED",
        { errorMessage: "Processing failed" }
      );
    });
  });

  describe("Input validation", () => {
    it("should handle missing preferences gracefully", async () => {
      const eventWithoutPreferences = {
        ...mockEvent,
        detail: {
          ...mockEvent.detail,
          preferences: undefined as any,
        },
      };

      await expect(handler(eventWithoutPreferences)).rejects.toThrow();
    });

    it("should handle missing insights gracefully", async () => {
      const eventWithoutInsights = {
        ...mockEvent,
        detail: {
          ...mockEvent.detail,
          insights: undefined as any,
        },
      };

      await expect(handler(eventWithoutInsights)).rejects.toThrow();
    });

    it("should handle empty user ID", async () => {
      const eventWithEmptyUserId = {
        ...mockEvent,
        detail: {
          ...mockEvent.detail,
          userId: "",
        },
      };

      await expect(handler(eventWithEmptyUserId)).rejects.toThrow();
    });
  });

  describe("Logging and monitoring", () => {
    it("should log key processing steps", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      await handler(mockEvent);

      // Check for structured logging format
      expect(consoleSpy).toHaveBeenCalledWith(
        "Info:",
        expect.stringContaining("Story Generation Lambda invoked")
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "Info:",
        expect.stringContaining("Starting story generation")
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "Info:",
        expect.stringContaining("Story generation completed successfully")
      );

      consoleSpy.mockRestore();
    });

    it("should log errors with context", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
      const error = new Error("Test error");
      mockBedrockInstance.generateStory.mockRejectedValue(error);

      await expect(handler(mockEvent)).rejects.toThrow();

      // Check for structured error logging format
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error occurred:",
        expect.stringContaining("Test error")
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Batch Workflow Support", () => {
    const mockBatchEvent: EventBridgeEvent<
      "Batch Story Generation Requested",
      BatchWorkflowEventDetail
    > = {
      version: "0",
      id: "test-batch-event-id",
      "detail-type": "Batch Story Generation Requested",
      source: "manga.workflow",
      account: "123456789012",
      time: "2024-01-01T00:00:00Z",
      region: "us-east-1",
      resources: [],
      detail: {
        userId: "test-user-123",
        workflowId: "test-workflow-456",
        requestId: "test-request-batch-1",
        numberOfStories: 3,
        currentBatch: 1,
        totalBatches: 3,
        preferences: {
          genres: ["Action", "Adventure"],
          themes: ["Friendship", "Growth"],
          artStyle: "Shonen",
          targetAudience: "Teen",
          contentRating: "PG-13",
        },
        insights: {
          recommendations: [
            { category: "Action", score: 0.9, attributes: {} },
            { category: "Adventure", score: 0.8, attributes: {} },
          ],
          trends: [
            { topic: "Friendship", popularity: 0.95 },
            { topic: "Growth", popularity: 0.85 },
          ],
        },
        timestamp: "2024-01-01T00:00:00Z",
      },
    };

    beforeEach(() => {
      // Setup additional mocks for batch workflow
      mockEventPublishingHelpers.publishBatchStoryGeneration = jest
        .fn()
        .mockResolvedValue();
      mockGenerationRequestAccess.create = jest.fn().mockResolvedValue();
    });

    describe("Batch workflow with provided preferences", () => {
      it("should successfully process batch workflow event with preferences", async () => {
        await handler(mockBatchEvent);

        // Verify generation request status updates with workflow context
        expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
          "test-user-123",
          "test-request-batch-1",
          "PROCESSING",
          {
            relatedEntityId: "test-story-id-123",
            workflowId: "test-workflow-456",
            currentBatch: 1,
          }
        );

        // Verify story generation with provided preferences
        expect(mockBedrockInstance.generateStory).toHaveBeenCalledWith(
          mockBatchEvent.detail.preferences,
          mockBatchEvent.detail.insights
        );

        // Verify story creation
        expect(mockStoryAccess.create).toHaveBeenCalledWith({
          storyId: "test-story-id-123",
          userId: "test-user-123",
          title: "The Adventure Begins",
          s3Key: "stories/test-user-123/test-story-id-123/story.md",
          status: "COMPLETED",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        });

        // Verify next batch story generation is triggered
        expect(mockGenerationRequestAccess.create).toHaveBeenCalledWith({
          userId: "test-user-123",
          requestId: "test-request-batch-1-batch-2",
          type: "STORY",
          status: "PENDING",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        });

        expect(
          mockEventPublishingHelpers.publishBatchStoryGeneration
        ).toHaveBeenCalledWith(
          "test-user-123",
          "test-workflow-456",
          "test-request-batch-1-batch-2",
          3,
          2,
          3,
          mockBatchEvent.detail.preferences,
          mockBatchEvent.detail.insights
        );
      });

      it("should complete batch workflow on final story", async () => {
        const finalBatchEvent = {
          ...mockBatchEvent,
          detail: {
            ...mockBatchEvent.detail,
            currentBatch: 3,
            totalBatches: 3,
            requestId: "test-request-batch-3",
          },
        };

        await handler(finalBatchEvent);

        // Verify story generation completes
        expect(mockStoryAccess.create).toHaveBeenCalled();

        // Verify no next batch is triggered
        expect(
          mockEventPublishingHelpers.publishBatchStoryGeneration
        ).not.toHaveBeenCalled();

        // Verify batch completion status update
        expect(
          mockEventPublishingHelpers.publishStatusUpdate
        ).toHaveBeenCalledWith(
          "test-user-123",
          "test-request-batch-3",
          "STORY",
          "COMPLETED",
          "test-workflow-456",
          "Batch workflow completed: 3 stories generated"
        );
      });
    });

    describe("Batch workflow with queried preferences", () => {
      const mockBatchEventWithoutPreferences: EventBridgeEvent<
        "Batch Story Generation Requested",
        BatchWorkflowEventDetail
      > = {
        ...mockBatchEvent,
        detail: {
          ...mockBatchEvent.detail,
          preferences: undefined as any,
          insights: undefined as any,
        },
      };

      it("should query user preferences when not provided in batch event", async () => {
        const mockUserPreferences = {
          preferences: {
            genres: ["Fantasy", "Romance"],
            themes: ["Magic", "Love"],
            artStyle: "Shoujo",
            targetAudience: "Young Adult",
            contentRating: "PG",
          },
          insights: {
            recommendations: [
              { category: "Fantasy", score: 0.95, attributes: {} },
              { category: "Romance", score: 0.85, attributes: {} },
            ],
            trends: [
              { topic: "Magic", popularity: 0.9 },
              { topic: "Love", popularity: 0.8 },
            ],
          },
          lastUpdated: "2024-01-01T00:00:00Z",
        };

        mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue(
          mockUserPreferences
        );

        await handler(mockBatchEventWithoutPreferences);

        // Verify user preferences were queried
        expect(
          mockUserPreferencesAccess.getLatestWithMetadata
        ).toHaveBeenCalledWith("test-user-123");

        // Verify story generation with queried preferences
        expect(mockBedrockInstance.generateStory).toHaveBeenCalledWith(
          mockUserPreferences.preferences,
          mockUserPreferences.insights
        );

        // Verify next batch uses queried preferences
        expect(
          mockEventPublishingHelpers.publishBatchStoryGeneration
        ).toHaveBeenCalledWith(
          "test-user-123",
          "test-workflow-456",
          "test-request-batch-1-batch-2",
          3,
          2,
          3,
          mockUserPreferences.preferences,
          mockUserPreferences.insights
        );
      });

      it("should handle missing user preferences gracefully", async () => {
        mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
          preferences: null,
        });

        await expect(handler(mockBatchEventWithoutPreferences)).rejects.toThrow(
          "No user preferences found for user test-user-123. User must submit preferences before starting batch workflow."
        );

        expect(
          mockUserPreferencesAccess.getLatestWithMetadata
        ).toHaveBeenCalledWith("test-user-123");
        expect(mockBedrockInstance.generateStory).not.toHaveBeenCalled();
      });

      it("should handle user preferences query errors", async () => {
        const queryError = new Error("DynamoDB query failed");
        mockUserPreferencesAccess.getLatestWithMetadata.mockRejectedValue(
          queryError
        );

        await expect(handler(mockBatchEventWithoutPreferences)).rejects.toThrow(
          "DynamoDB query failed"
        );

        expect(
          mockUserPreferencesAccess.getLatestWithMetadata
        ).toHaveBeenCalledWith("test-user-123");
        expect(mockBedrockInstance.generateStory).not.toHaveBeenCalled();
      });
    });

    describe("Batch workflow error handling", () => {
      it("should continue batch workflow on individual story failure", async () => {
        const storyError = new Error("Story generation failed");
        mockBedrockInstance.generateStory.mockRejectedValue(storyError);

        // Should not throw for batch workflow
        await handler(mockBatchEvent);

        // Verify error was logged but next batch was still triggered
        expect(mockGenerationRequestAccess.create).toHaveBeenCalledWith({
          userId: "test-user-123",
          requestId: "test-request-batch-1-batch-2",
          type: "STORY",
          status: "PENDING",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        });

        expect(
          mockEventPublishingHelpers.publishBatchStoryGeneration
        ).toHaveBeenCalledWith(
          "test-user-123",
          "test-workflow-456",
          "test-request-batch-1-batch-2",
          3,
          2,
          3,
          mockBatchEvent.detail.preferences,
          mockBatchEvent.detail.insights
        );

        // Verify failed status was recorded
        expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
          "test-user-123",
          "test-request-batch-1",
          "FAILED",
          {
            errorMessage: "Story generation failed",
            relatedEntityId: "test-story-id-123",
            workflowId: "test-workflow-456",
            currentBatch: 1,
          }
        );
      });

      it("should handle final batch failure appropriately", async () => {
        const finalBatchEvent = {
          ...mockBatchEvent,
          detail: {
            ...mockBatchEvent.detail,
            currentBatch: 3,
            totalBatches: 3,
            requestId: "test-request-batch-3",
          },
        };

        const finalError = new Error("Final story failed");
        mockBedrockInstance.generateStory.mockRejectedValue(finalError);

        await handler(finalBatchEvent);

        // Verify no next batch is triggered
        expect(
          mockEventPublishingHelpers.publishBatchStoryGeneration
        ).not.toHaveBeenCalled();

        // Verify batch workflow failure status
        expect(
          mockEventPublishingHelpers.publishStatusUpdate
        ).toHaveBeenCalledWith(
          "test-user-123",
          "test-request-batch-3",
          "STORY",
          "FAILED",
          "test-workflow-456",
          "Batch workflow failed on final story: Final story failed"
        );
      });

      it("should handle next batch triggering errors gracefully", async () => {
        const nextBatchError = new Error("Failed to trigger next batch");
        mockEventPublishingHelpers.publishBatchStoryGeneration.mockRejectedValue(
          nextBatchError
        );

        // Should still complete current story successfully
        await handler(mockBatchEvent);

        // Verify current story was completed
        expect(mockStoryAccess.create).toHaveBeenCalled();
        expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
          "test-user-123",
          "test-request-batch-1",
          "COMPLETED",
          { relatedEntityId: "test-story-id-123" }
        );

        // Verify attempt to trigger next batch was made
        expect(
          mockEventPublishingHelpers.publishBatchStoryGeneration
        ).toHaveBeenCalled();
      });
    });

    describe("Batch workflow logging and monitoring", () => {
      it("should log batch workflow context", async () => {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();

        await handler(mockBatchEvent);

        // Check for structured logging format
        expect(consoleSpy).toHaveBeenCalledWith(
          "Info:",
          expect.stringContaining("Story Generation Lambda invoked")
        );

        // Verify the log contains batch workflow context
        const logCalls = consoleSpy.mock.calls;
        const batchContextLog = logCalls.find(
          (call) =>
            call[0] === "Info:" &&
            call[1].includes("Story Generation Lambda invoked") &&
            call[1].includes("BatchWorkflow")
        );
        expect(batchContextLog).toBeDefined();

        consoleSpy.mockRestore();
      });

      it("should log batch completion tracking", async () => {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();

        await handler(mockBatchEvent);

        // Check for structured logging format
        expect(consoleSpy).toHaveBeenCalledWith(
          "Info:",
          expect.stringContaining("Processing batch workflow completion")
        );

        expect(consoleSpy).toHaveBeenCalledWith(
          "Info:",
          expect.stringContaining("Triggering next story in batch workflow")
        );

        consoleSpy.mockRestore();
      });
    });
  });
});
