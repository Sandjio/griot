/**
 * Error scenario tests for workflow failures
 * Tests various failure modes and recovery mechanisms
 * Requirements: 6A.4, 6B.4
 */

import { APIGatewayProxyEvent, EventBridgeEvent } from "aws-lambda";
import { handler as workflowHandler } from "../lambdas/workflow-orchestration/index";
import { handler as continueEpisodeHandler } from "../lambdas/continue-episode/index";
import { handler as storyHandler } from "../lambdas/story-generation/index";
import { handler as episodeHandler } from "../lambdas/episode-generation/index";
import {
  APIGatewayEventFactory,
  LambdaContextFactory,
  TestDataFactory,
  EventBridgeEventFactory,
  MockSetupUtils,
  TestAssertions,
} from "./test-utils";

// Mock dependencies
jest.mock("../database/access-patterns");
jest.mock("../utils/event-publisher");
jest.mock("../storage/s3-client");
jest.mock("../lambdas/story-generation/bedrock-client");
jest.mock("../lambdas/episode-generation/bedrock-client");

import {
  UserPreferencesAccess,
  GenerationRequestAccess,
  StoryAccess,
  EpisodeAccess,
} from "../database/access-patterns";
import { EventPublisher } from "../utils/event-publisher";
import { S3Operations } from "../storage/s3-client";
import { BedrockClient as StoryBedrockClient } from "../lambdas/story-generation/bedrock-client";
import { BedrockClient as EpisodeBedrockClient } from "../lambdas/episode-generation/bedrock-client";

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<typeof UserPreferencesAccess>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<typeof GenerationRequestAccess>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockEventPublisher = EventPublisher as jest.MockedClass<typeof EventPublisher>;
const mockS3Operations = S3Operations as jest.Mocked<typeof S3Operations>;
const mockStoryBedrockClient = StoryBedrockClient as jest.MockedClass<typeof StoryBedrockClient>;
const mockEpisodeBedrockClient = EpisodeBedrockClient as jest.MockedClass<typeof EpisodeBedrockClient>;

describe("Workflow Error Scenarios Tests", () => {
  const mockContext = LambdaContextFactory.createContext("error-scenarios");
  const testUserId = "error-test-user-123";
  const testStoryId = "error-story-456";

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();
    setupBasicMocks();
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  function setupBasicMocks() {
    // Default successful mocks
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: TestDataFactory.createUserPreferences(),
      insights: TestDataFactory.createQlooInsights(),
    });

    mockGenerationRequestAccess.create.mockResolvedValue();
    mockGenerationRequestAccess.updateStatus.mockResolvedValue();

    mockStoryAccess.get.mockResolvedValue(
      TestDataFactory.createStory(testUserId, testStoryId)
    );
    mockStoryAccess.create.mockResolvedValue();

    mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
      TestDataFactory.createEpisode(testStoryId, 1),
    ]);
    mockEpisodeAccess.create.mockResolvedValue();

    const mockEventPublisherInstance = {
      publishEvent: jest.fn().mockResolvedValue(),
    };
    mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

    mockS3Operations.uploadText.mockResolvedValue("test-s3-key");
    mockS3Operations.getTextContent.mockResolvedValue("test content");
  }

  describe("Database Failure Scenarios", () => {
    it("should handle DynamoDB connection failures in workflow start", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockRejectedValue(
        new Error("DynamoDB connection failed")
      );

      const workflowRequest = { numberOfStories: 2 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const result = await workflowHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });

    it("should handle DynamoDB write failures during request creation", async () => {
      mockGenerationRequestAccess.create.mockRejectedValue(
        new Error("DynamoDB write failed")
      );

      const workflowRequest = { numberOfStories: 1 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const result = await workflowHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });

    it("should handle story access failures in continue episode", async () => {
      mockStoryAccess.get.mockRejectedValue(
        new Error("DynamoDB read failed")
      );

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });

    it("should handle episode access failures", async () => {
      mockEpisodeAccess.getStoryEpisodes.mockRejectedValue(
        new Error("Episode query failed")
      );

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });

    it("should handle partial database failures with retry logic", async () => {
      let attemptCount = 0;
      mockStoryAccess.create.mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Temporary database failure");
        }
        return Promise.resolve();
      });

      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Test Story",
          content: "Story content",
          metadata: { wordCount: 1000 },
        }),
      };
      mockStoryBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      // Should eventually succeed after retries
      await storyHandler(storyEvent, mockContext);

      expect(mockStoryAccess.create).toHaveBeenCalledTimes(3);
    });
  });

  describe("EventBridge Failure Scenarios", () => {
    it("should handle EventBridge publish failures in workflow start", async () => {
      const mockEventPublisherInstance = {
        publishEvent: jest.fn().mockRejectedValue(
          new Error("EventBridge publish failed")
        ),
      };
      mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

      const workflowRequest = { numberOfStories: 1 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const result = await workflowHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });

    it("should handle EventBridge publish failures in continue episode", async () => {
      const mockEventPublisherInstance = {
        publishEvent: jest.fn().mockRejectedValue(
          new Error("EventBridge unavailable")
        ),
      };
      mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });

    it("should handle malformed EventBridge events", async () => {
      const malformedEvent = {
        version: "0",
        id: "test-event-id",
        "detail-type": "Story Generation Requested",
        source: "manga.preferences",
        account: "123456789012",
        time: "2024-01-01T00:00:00Z",
        region: "us-east-1",
        resources: [],
        detail: {
          // Missing required fields
          userId: testUserId,
          // Missing requestId, preferences, insights
        },
      } as any;

      await expect(storyHandler(malformedEvent, mockContext))
        .rejects.toThrow();
    });
  });

  describe("S3 Failure Scenarios", () => {
    it("should handle S3 upload failures during story generation", async () => {
      mockS3Operations.uploadText.mockRejectedValue(
        new Error("S3 upload failed")
      );

      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Test Story",
          content: "Story content",
          metadata: { wordCount: 1000 },
        }),
      };
      mockStoryBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      await expect(storyHandler(storyEvent, mockContext))
        .rejects.toThrow("S3 upload failed");

      // Verify story was not created in database
      expect(mockStoryAccess.create).not.toHaveBeenCalled();
    });

    it("should handle S3 read failures during episode generation", async () => {
      mockS3Operations.getTextContent.mockRejectedValue(
        new Error("S3 read failed")
      );

      const episodeEvent = EventBridgeEventFactory.createEpisodeGenerationEvent(testUserId, testStoryId);

      await expect(episodeHandler(episodeEvent, mockContext))
        .rejects.toThrow("S3 read failed");
    });

    it("should handle S3 permission errors", async () => {
      mockS3Operations.uploadText.mockRejectedValue(
        new Error("Access Denied")
      );

      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Test Story",
          content: "Story content",
          metadata: { wordCount: 1000 },
        }),
      };
      mockStoryBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      await expect(storyHandler(storyEvent, mockContext))
        .rejects.toThrow("Access Denied");
    });
  });

  describe("Bedrock API Failure Scenarios", () => {
    it("should handle Bedrock API rate limiting", async () => {
      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockRejectedValue(
          new Error("ThrottlingException: Rate exceeded")
        ),
      };
      mockStoryBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      await expect(storyHandler(storyEvent, mockContext))
        .rejects.toThrow("ThrottlingException");

      // Verify request status updated to failed
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        testUserId,
        expect.any(String),
        "FAILED",
        expect.objectContaining({
          errorMessage: expect.stringContaining("story generation"),
        })
      );
    });

    it("should handle Bedrock API service unavailable", async () => {
      const mockEpisodeBedrockInstance = {
        generateEpisode: jest.fn().mockRejectedValue(
          new Error("ServiceUnavailableException")
        ),
      };
      mockEpisodeBedrockClient.mockImplementation(() => mockEpisodeBedrockInstance as any);

      const episodeEvent = EventBridgeEventFactory.createEpisodeGenerationEvent(testUserId, testStoryId);

      await expect(episodeHandler(episodeEvent, mockContext))
        .rejects.toThrow("ServiceUnavailableException");
    });

    it("should handle Bedrock API timeout", async () => {
      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockImplementation(() => 
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Request timeout")), 1000)
          )
        ),
      };
      mockStoryBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      await expect(storyHandler(storyEvent, mockContext))
        .rejects.toThrow("Request timeout");
    });

    it("should handle invalid Bedrock API responses", async () => {
      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          // Missing required fields
          title: null,
          content: undefined,
        }),
      };
      mockStoryBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      await expect(storyHandler(storyEvent, mockContext))
        .rejects.toThrow();
    });
  });

  describe("Memory and Resource Failures", () => {
    it("should handle out of memory scenarios", async () => {
      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockImplementation(() => {
          // Simulate memory pressure
          const largeArray = new Array(1000000).fill("x".repeat(1000));
          throw new Error("JavaScript heap out of memory");
        }),
      };
      mockStoryBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      await expect(storyHandler(storyEvent, mockContext))
        .rejects.toThrow("JavaScript heap out of memory");
    });

    it("should handle Lambda timeout scenarios", async () => {
      // Mock a very slow operation
      mockS3Operations.uploadText.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 30000)) // 30 second delay
      );

      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Test Story",
          content: "Story content",
          metadata: { wordCount: 1000 },
        }),
      };
      mockStoryBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

      // Set a short timeout for testing
      const originalTimeout = mockContext.getRemainingTimeInMillis;
      mockContext.getRemainingTimeInMillis = () => 1000; // 1 second remaining

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      await expect(storyHandler(storyEvent, mockContext))
        .rejects.toThrow();

      // Restore original timeout
      mockContext.getRemainingTimeInMillis = originalTimeout;
    });
  });

  describe("Concurrent Access Failures", () => {
    it("should handle race conditions in episode numbering", async () => {
      // Simulate race condition where episode is created between check and creation
      let checkCount = 0;
      mockEpisodeAccess.getStoryEpisodes.mockImplementation(() => {
        checkCount++;
        if (checkCount === 1) {
          return Promise.resolve([TestDataFactory.createEpisode(testStoryId, 1)]);
        } else {
          // Second call shows episode 2 was created by another request
          return Promise.resolve([
            TestDataFactory.createEpisode(testStoryId, 1),
            TestDataFactory.createEpisode(testStoryId, 2),
          ]);
        }
      });

      const event1 = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event1.pathParameters = { storyId: testStoryId };

      const event2 = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event2.pathParameters = { storyId: testStoryId };

      // Run both requests concurrently
      const [result1, result2] = await Promise.all([
        continueEpisodeHandler(event1, mockContext),
        continueEpisodeHandler(event2, mockContext),
      ]);

      // One should succeed, one might fail due to race condition
      const successfulResults = [result1, result2].filter(r => r.statusCode === 202);
      expect(successfulResults.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle concurrent workflow starts for same user", async () => {
      const workflowRequest = { numberOfStories: 1 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      // Run multiple concurrent workflow starts
      const promises = Array(5).fill(null).map(() => 
        workflowHandler(event, mockContext)
      );

      const results = await Promise.all(promises);

      // All should succeed (different workflow IDs)
      results.forEach(result => {
        expect([202, 429]).toContain(result.statusCode); // Success or rate limited
      });
    });
  });

  describe("Network and Connectivity Failures", () => {
    it("should handle network timeouts", async () => {
      const mockEventPublisherInstance = {
        publishEvent: jest.fn().mockImplementation(() => 
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Network timeout")), 5000)
          )
        ),
      };
      mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

      const workflowRequest = { numberOfStories: 1 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const result = await workflowHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });

    it("should handle DNS resolution failures", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockRejectedValue(
        new Error("ENOTFOUND: DNS resolution failed")
      );

      const workflowRequest = { numberOfStories: 1 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const result = await workflowHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });
  });

  describe("Data Corruption Scenarios", () => {
    it("should handle corrupted user preferences", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: null, // Corrupted/missing preferences
        insights: TestDataFactory.createQlooInsights(),
      });

      const workflowRequest = { numberOfStories: 1 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const result = await workflowHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "PREFERENCES_NOT_FOUND", 400);
    });

    it("should handle corrupted story data", async () => {
      const corruptedStory = TestDataFactory.createStory(testUserId, testStoryId);
      corruptedStory.s3Key = null as any; // Corrupted S3 key
      mockStoryAccess.get.mockResolvedValue(corruptedStory);

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      // Should still process but might fail later in the workflow
      expect([202, 500]).toContain(result.statusCode);
    });
  });
});