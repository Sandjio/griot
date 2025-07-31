/**
 * Integration tests for continue episode functionality
 * Tests episode continuation workflow from request to completion
 * Requirements: 6B.4, 6B.6
 */

import { APIGatewayProxyEvent, EventBridgeEvent } from "aws-lambda";
import { handler as continueEpisodeHandler } from "../lambdas/continue-episode/index";
import { handler as episodeGenerationHandler } from "../lambdas/episode-generation/index";
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
jest.mock("../lambdas/episode-generation/bedrock-client");

import {
  StoryAccess,
  EpisodeAccess,
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../database/access-patterns";
import { EventPublisher } from "../utils/event-publisher";
import { S3Operations } from "../storage/s3-client";
import { BedrockClient } from "../lambdas/episode-generation/bedrock-client";

const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<typeof UserPreferencesAccess>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<typeof GenerationRequestAccess>;
const mockEventPublisher = EventPublisher as jest.MockedClass<typeof EventPublisher>;
const mockS3Operations = S3Operations as jest.Mocked<typeof S3Operations>;
const mockBedrockClient = BedrockClient as jest.MockedClass<typeof BedrockClient>;

describe("Continue Episode Integration Tests", () => {
  const mockContext = LambdaContextFactory.createContext("continue-episode");
  const testUserId = "episode-user-123";
  const testStoryId = "story-456";
  const testEpisodeId = "episode-789";

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();
    setupContinueEpisodeMocks();
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  function setupContinueEpisodeMocks() {
    // Story access mocks
    mockStoryAccess.get.mockResolvedValue(
      TestDataFactory.createStory(testUserId, testStoryId)
    );

    // Episode access mocks
    mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
      TestDataFactory.createEpisode(testStoryId, 1),
      TestDataFactory.createEpisode(testStoryId, 2),
    ]);
    mockEpisodeAccess.create.mockResolvedValue();

    // User preferences mock
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: TestDataFactory.createUserPreferences(),
      insights: TestDataFactory.createQlooInsights(),
    });

    // Generation request mocks
    mockGenerationRequestAccess.create.mockResolvedValue();

    // Event publisher mock
    const mockEventPublisherInstance = {
      publishEvent: jest.fn().mockResolvedValue(),
    };
    mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

    // Episode generation mocks
    const mockBedrockInstance = {
      generateEpisode: jest.fn().mockResolvedValue({
        content: "Generated episode content",
        metadata: { wordCount: 800, sceneCount: 3 },
      }),
    };
    mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

    // Storage mocks
    mockS3Operations.uploadText.mockResolvedValue("episode-s3-key");
    mockS3Operations.getTextContent.mockResolvedValue("Original story content");
  }

  describe("Continue Episode Request", () => {
    it("should successfully initiate episode continuation", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidAPIResponse(result, 202);
      const response = JSON.parse(result.body);

      expect(response.episodeId).toBeDefined();
      expect(response.episodeNumber).toBe(3); // Next episode after existing 2
      expect(response.status).toBe("GENERATING");
      expect(response.estimatedCompletionTime).toBeDefined();

      // Verify database operations
      expect(mockStoryAccess.get).toHaveBeenCalledWith(testUserId, testStoryId);
      expect(mockEpisodeAccess.getStoryEpisodes).toHaveBeenCalledWith(testStoryId);
      expect(mockUserPreferencesAccess.getLatestWithMetadata).toHaveBeenCalledWith(testUserId);
      expect(mockGenerationRequestAccess.create).toHaveBeenCalled();

      // Verify event publishing
      const mockInstance = mockEventPublisher.mock.instances[0];
      expect(mockInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "manga.story",
          "detail-type": "Continue Episode Requested",
          detail: expect.objectContaining({
            userId: testUserId,
            storyId: testStoryId,
            nextEpisodeNumber: 3,
          }),
        })
      );
    });

    it("should handle story not found", async () => {
      mockStoryAccess.get.mockResolvedValue(null);

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "STORY_NOT_FOUND", 404);
    });

    it("should reject continuation for incomplete story", async () => {
      const incompleteStory = TestDataFactory.createStory(testUserId, testStoryId);
      incompleteStory.status = "PROCESSING";
      mockStoryAccess.get.mockResolvedValue(incompleteStory);

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "STORY_NOT_COMPLETED", 400);
    });

    it("should handle missing user preferences", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: null,
        insights: null,
      });

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "PREFERENCES_NOT_FOUND", 400);
    });

    it("should handle episode already exists", async () => {
      const existingEpisodes = [
        TestDataFactory.createEpisode(testStoryId, 1),
        TestDataFactory.createEpisode(testStoryId, 2),
        TestDataFactory.createEpisode(testStoryId, 3), // Episode 3 already exists
      ];
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue(existingEpisodes);

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "EPISODE_ALREADY_EXISTS", 409);
    });

    it("should enforce rate limiting", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      // Simulate multiple rapid requests
      const promises = Array(12).fill(null).map(() => 
        continueEpisodeHandler(event, mockContext)
      );

      const results = await Promise.all(promises);
      
      // At least one should be rate limited
      const rateLimitedResults = results.filter(r => r.statusCode === 429);
      expect(rateLimitedResults.length).toBeGreaterThan(0);
    });
  });

  describe("Episode Generation Workflow", () => {
    it("should generate episode from continue request", async () => {
      const continueEpisodeEvent: EventBridgeEvent<"Continue Episode Requested", any> = {
        version: "0",
        id: "test-event-id",
        "detail-type": "Continue Episode Requested",
        source: "manga.story",
        account: "123456789012",
        time: "2024-01-01T00:00:00Z",
        region: "us-east-1",
        resources: [],
        detail: {
          userId: testUserId,
          storyId: testStoryId,
          nextEpisodeNumber: 3,
          originalPreferences: TestDataFactory.createUserPreferences(),
          storyS3Key: `stories/${testUserId}/${testStoryId}/story.md`,
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      await episodeGenerationHandler(continueEpisodeEvent, mockContext);

      // Verify episode creation
      expect(mockEpisodeAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storyId: testStoryId,
          episodeNumber: 3,
          status: "COMPLETED",
        })
      );

      // Verify story content was retrieved
      expect(mockS3Operations.getTextContent).toHaveBeenCalledWith(
        `stories/${testUserId}/${testStoryId}/story.md`
      );

      // Verify episode content was uploaded
      expect(mockS3Operations.uploadText).toHaveBeenCalledWith(
        expect.stringContaining(`episodes/${testUserId}/${testStoryId}/3/episode.md`),
        "Generated episode content",
        "text/markdown"
      );
    });

    it("should handle episode generation failure", async () => {
      const mockBedrockInstance = {
        generateEpisode: jest.fn().mockRejectedValue(new Error("Episode generation failed")),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      const continueEpisodeEvent: EventBridgeEvent<"Continue Episode Requested", any> = {
        version: "0",
        id: "test-event-id",
        "detail-type": "Continue Episode Requested",
        source: "manga.story",
        account: "123456789012",
        time: "2024-01-01T00:00:00Z",
        region: "us-east-1",
        resources: [],
        detail: {
          userId: testUserId,
          storyId: testStoryId,
          nextEpisodeNumber: 3,
          originalPreferences: TestDataFactory.createUserPreferences(),
          storyS3Key: `stories/${testUserId}/${testStoryId}/story.md`,
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      await expect(episodeGenerationHandler(continueEpisodeEvent, mockContext))
        .rejects.toThrow("Episode generation failed");

      // Verify episode was not created
      expect(mockEpisodeAccess.create).not.toHaveBeenCalled();
    });
  });

  describe("Multiple Episode Continuation", () => {
    it("should handle multiple episode continuations for same story", async () => {
      // Start with 2 existing episodes
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
        TestDataFactory.createEpisode(testStoryId, 1),
        TestDataFactory.createEpisode(testStoryId, 2),
      ]);

      // First continuation request (episode 3)
      const event1 = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event1.pathParameters = { storyId: testStoryId };

      const result1 = await continueEpisodeHandler(event1, mockContext);
      expect(result1.statusCode).toBe(202);
      const response1 = JSON.parse(result1.body);
      expect(response1.episodeNumber).toBe(3);

      // Update mock to include the new episode
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
        TestDataFactory.createEpisode(testStoryId, 1),
        TestDataFactory.createEpisode(testStoryId, 2),
        TestDataFactory.createEpisode(testStoryId, 3),
      ]);

      // Second continuation request (episode 4)
      const event2 = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event2.pathParameters = { storyId: testStoryId };

      const result2 = await continueEpisodeHandler(event2, mockContext);
      expect(result2.statusCode).toBe(202);
      const response2 = JSON.parse(result2.body);
      expect(response2.episodeNumber).toBe(4);

      // Verify both requests were processed correctly
      expect(mockGenerationRequestAccess.create).toHaveBeenCalledTimes(2);
    });

    it("should maintain episode numbering consistency", async () => {
      // Test with gaps in episode numbers
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
        TestDataFactory.createEpisode(testStoryId, 1),
        TestDataFactory.createEpisode(testStoryId, 3), // Missing episode 2
        TestDataFactory.createEpisode(testStoryId, 4),
      ]);

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);
      expect(result.statusCode).toBe(202);
      
      const response = JSON.parse(result.body);
      expect(response.episodeNumber).toBe(5); // Next after highest existing number
    });
  });

  describe("Cross-User Security", () => {
    it("should prevent episode continuation for other user's story", async () => {
      const otherUserId = "other-user-456";
      mockStoryAccess.get.mockResolvedValue(null); // Story not found for current user

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        otherUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "STORY_NOT_FOUND", 404);
      expect(mockStoryAccess.get).toHaveBeenCalledWith(otherUserId, testStoryId);
    });

    it("should validate authentication", async () => {
      const event = APIGatewayEventFactory.createUnauthenticatedEvent(
        "POST",
        `/stories/${testStoryId}/episodes`
      );
      event.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "UNAUTHORIZED", 401);
    });
  });

  describe("Performance Requirements", () => {
    it("should complete episode continuation request within 2 seconds", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      const startTime = Date.now();
      const result = await continueEpisodeHandler(event, mockContext);
      const duration = Date.now() - startTime;

      expect(result.statusCode).toBe(202);
      expect(duration).toBeLessThan(2000);
    });

    it("should handle concurrent episode continuation requests", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      event.pathParameters = { storyId: testStoryId };

      // Simulate concurrent requests
      const promises = Array(5).fill(null).map(() => 
        continueEpisodeHandler(event, mockContext)
      );

      const results = await Promise.all(promises);

      // First request should succeed, others might fail due to race conditions
      const successfulResults = results.filter(r => r.statusCode === 202);
      expect(successfulResults.length).toBeGreaterThanOrEqual(1);
    });
  });
});