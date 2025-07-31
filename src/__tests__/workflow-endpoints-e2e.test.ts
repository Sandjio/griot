/**
 * End-to-end tests for new API endpoints
 * Tests complete user journeys through new workflow endpoints
 * Requirements: 6A.3, 6A.4, 6B.4, 6B.6
 */

import { APIGatewayProxyEvent } from "aws-lambda";
import { handler as workflowHandler } from "../lambdas/workflow-orchestration/index";
import { handler as continueEpisodeHandler } from "../lambdas/continue-episode/index";
import { handler as statusHandler } from "../lambdas/status-check/index";
import { handler as contentRetrievalHandler } from "../lambdas/content-retrieval/index";
import {
  APIGatewayEventFactory,
  LambdaContextFactory,
  TestDataFactory,
  MockSetupUtils,
  TestAssertions,
  PerformanceTestUtils,
} from "./test-utils";

// Mock dependencies
jest.mock("../database/access-patterns");
jest.mock("../utils/event-publisher");
jest.mock("../storage/s3-client");

import {
  UserPreferencesAccess,
  GenerationRequestAccess,
  StoryAccess,
  EpisodeAccess,
} from "../database/access-patterns";
import { EventPublisher } from "../utils/event-publisher";
import { S3Operations } from "../storage/s3-client";

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<typeof UserPreferencesAccess>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<typeof GenerationRequestAccess>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockEventPublisher = EventPublisher as jest.MockedClass<typeof EventPublisher>;
const mockS3Operations = S3Operations as jest.Mocked<typeof S3Operations>;

describe("Workflow Endpoints E2E Tests", () => {
  const mockContext = LambdaContextFactory.createContext("workflow-e2e");
  const testUserId = "e2e-user-123";
  const testStoryId = "e2e-story-456";
  const testRequestId = "e2e-request-789";

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();
    setupE2EMocks();
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  function setupE2EMocks() {
    // User preferences mock
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: TestDataFactory.createUserPreferences(),
      insights: TestDataFactory.createQlooInsights(),
    });

    // Generation request mocks
    mockGenerationRequestAccess.create.mockResolvedValue();
    mockGenerationRequestAccess.getByRequestId.mockResolvedValue({
      PK: `USER#${testUserId}`,
      SK: `REQUEST#${testRequestId}`,
      GSI1PK: `REQUEST#${testRequestId}`,
      GSI1SK: "STATUS",
      GSI2PK: "STATUS#COMPLETED",
      GSI2SK: "2024-01-01T00:00:00.000Z",
      requestId: testRequestId,
      userId: testUserId,
      type: "STORY",
      status: "COMPLETED",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      result: {
        storyId: testStoryId,
        episodeCount: 1,
      },
    });

    // Story access mocks
    mockStoryAccess.get.mockResolvedValue(
      TestDataFactory.createStory(testUserId, testStoryId)
    );
    mockStoryAccess.getByUserId.mockResolvedValue([
      TestDataFactory.createStory(testUserId, testStoryId),
    ]);

    // Episode access mocks
    mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
      TestDataFactory.createEpisode(testStoryId, 1),
    ]);
    mockEpisodeAccess.getByStoryId.mockResolvedValue([
      TestDataFactory.createEpisode(testStoryId, 1),
    ]);

    // Event publisher mock
    const mockEventPublisherInstance = {
      publishEvent: jest.fn().mockResolvedValue(),
    };
    mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

    // Storage mocks
    mockS3Operations.generatePresignedUrl.mockResolvedValue(
      "https://test-presigned-url.com"
    );
  }

  describe("Batch Workflow E2E Journey", () => {
    it("should complete full batch workflow journey", async () => {
      // Step 1: Start batch workflow
      const workflowRequest = {
        numberOfStories: 3,
        batchSize: 1,
      };

      const workflowEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const workflowResult = await workflowHandler(workflowEvent, mockContext);

      TestAssertions.expectValidAPIResponse(workflowResult, 202);
      const workflowResponse = JSON.parse(workflowResult.body);

      expect(workflowResponse.workflowId).toBeDefined();
      expect(workflowResponse.requestId).toBeDefined();
      expect(workflowResponse.numberOfStories).toBe(3);
      expect(workflowResponse.status).toBe("STARTED");
      expect(workflowResponse.estimatedCompletionTime).toBeDefined();

      // Step 2: Check workflow status
      const statusEvent = APIGatewayEventFactory.createEvent(
        "GET",
        `/status/${workflowResponse.requestId}`,
        null,
        testUserId
      );
      statusEvent.pathParameters = { requestId: workflowResponse.requestId };

      const statusResult = await statusHandler(statusEvent, mockContext);

      TestAssertions.expectValidAPIResponse(statusResult, 200);
      const statusResponse = JSON.parse(statusResult.body);

      expect(statusResponse.data.requestId).toBe(workflowResponse.requestId);
      expect(statusResponse.data.status).toBe("COMPLETED");
      expect(statusResponse.data.result).toBeDefined();

      // Step 3: Retrieve generated content
      const contentEvent = APIGatewayEventFactory.createEvent(
        "GET",
        "/stories",
        null,
        testUserId
      );

      const contentResult = await contentRetrievalHandler(contentEvent, mockContext);

      TestAssertions.expectValidAPIResponse(contentResult, 200);
      const contentResponse = JSON.parse(contentResult.body);

      expect(contentResponse.success).toBe(true);
      expect(contentResponse.data.stories).toHaveLength(1);
      expect(contentResponse.data.stories[0].downloadUrl).toBeDefined();

      // Verify all database operations were called
      expect(mockUserPreferencesAccess.getLatestWithMetadata).toHaveBeenCalledWith(testUserId);
      expect(mockGenerationRequestAccess.create).toHaveBeenCalled();
      expect(mockGenerationRequestAccess.getByRequestId).toHaveBeenCalledWith(workflowResponse.requestId);
      expect(mockStoryAccess.getByUserId).toHaveBeenCalledWith(testUserId);

      // Verify event publishing
      const mockInstance = mockEventPublisher.mock.instances[0];
      expect(mockInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "manga.workflow",
          "detail-type": "Batch Story Generation Requested",
        })
      );
    });

    it("should handle workflow status polling", async () => {
      // Mock different status states over time
      const statusStates = [
        { status: "PROCESSING", progress: 25, currentStep: "STORY_GENERATION" },
        { status: "PROCESSING", progress: 50, currentStep: "EPISODE_GENERATION" },
        { status: "PROCESSING", progress: 75, currentStep: "IMAGE_GENERATION" },
        { status: "COMPLETED", progress: 100, result: { storyId: testStoryId } },
      ];

      for (let i = 0; i < statusStates.length; i++) {
        const state = statusStates[i];
        mockGenerationRequestAccess.getByRequestId.mockResolvedValueOnce({
          PK: `USER#${testUserId}`,
          SK: `REQUEST#${testRequestId}`,
          GSI1PK: `REQUEST#${testRequestId}`,
          GSI1SK: "STATUS",
          GSI2PK: `STATUS#${state.status}`,
          GSI2SK: "2024-01-01T00:00:00.000Z",
          requestId: testRequestId,
          userId: testUserId,
          type: "STORY",
          ...state,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        });

        const statusEvent = APIGatewayEventFactory.createEvent(
          "GET",
          `/status/${testRequestId}`,
          null,
          testUserId
        );
        statusEvent.pathParameters = { requestId: testRequestId };

        const result = await statusHandler(statusEvent, mockContext);

        TestAssertions.expectValidAPIResponse(result, 200);
        const response = JSON.parse(result.body);

        expect(response.data.status).toBe(state.status);
        expect(response.data.progress).toBe(state.progress);
        if (state.currentStep) {
          expect(response.data.currentStep).toBe(state.currentStep);
        }
      }
    });

    it("should handle large batch workflow requests", async () => {
      const workflowRequest = {
        numberOfStories: 10, // Maximum allowed
        batchSize: 2,
      };

      const workflowEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const { result, duration } = await PerformanceTestUtils.measureExecutionTime(() =>
        workflowHandler(workflowEvent, mockContext)
      );

      TestAssertions.expectValidAPIResponse(result, 202);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

      const response = JSON.parse(result.body);
      expect(response.numberOfStories).toBe(10);
      expect(response.estimatedCompletionTime).toBeDefined();

      // Verify event was published with correct batch configuration
      const mockInstance = mockEventPublisher.mock.instances[0];
      expect(mockInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            numberOfStories: 10,
            totalBatches: 5, // 10 stories / 2 batch size
          }),
        })
      );
    });
  });

  describe("Continue Episode E2E Journey", () => {
    it("should complete full episode continuation journey", async () => {
      // Step 1: Request episode continuation
      const continueEvent = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      continueEvent.pathParameters = { storyId: testStoryId };

      const continueResult = await continueEpisodeHandler(continueEvent, mockContext);

      TestAssertions.expectValidAPIResponse(continueResult, 202);
      const continueResponse = JSON.parse(continueResult.body);

      expect(continueResponse.episodeId).toBeDefined();
      expect(continueResponse.episodeNumber).toBe(2); // Next after existing episode 1
      expect(continueResponse.status).toBe("GENERATING");
      expect(continueResponse.estimatedCompletionTime).toBeDefined();

      // Step 2: Check story details to see new episode
      const storyEvent = APIGatewayEventFactory.createEvent(
        "GET",
        `/stories/${testStoryId}`,
        null,
        testUserId
      );
      storyEvent.pathParameters = { storyId: testStoryId };

      // Mock updated episodes list
      mockEpisodeAccess.getByStoryId.mockResolvedValue([
        TestDataFactory.createEpisode(testStoryId, 1),
        TestDataFactory.createEpisode(testStoryId, 2),
      ]);

      const storyResult = await contentRetrievalHandler(storyEvent, mockContext);

      TestAssertions.expectValidAPIResponse(storyResult, 200);
      const storyResponse = JSON.parse(storyResult.body);

      expect(storyResponse.success).toBe(true);
      expect(storyResponse.data.story).toBeDefined();
      expect(storyResponse.data.episodes).toHaveLength(2);

      // Verify database operations
      expect(mockStoryAccess.get).toHaveBeenCalledWith(testUserId, testStoryId);
      expect(mockEpisodeAccess.getStoryEpisodes).toHaveBeenCalledWith(testStoryId);
      expect(mockUserPreferencesAccess.getLatestWithMetadata).toHaveBeenCalledWith(testUserId);

      // Verify event publishing
      const mockInstance = mockEventPublisher.mock.instances[0];
      expect(mockInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "manga.story",
          "detail-type": "Continue Episode Requested",
          detail: expect.objectContaining({
            userId: testUserId,
            storyId: testStoryId,
            nextEpisodeNumber: 2,
          }),
        })
      );
    });

    it("should handle multiple episode continuations", async () => {
      // Start with 1 existing episode
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
        TestDataFactory.createEpisode(testStoryId, 1),
      ]);

      // First continuation (episode 2)
      const continueEvent1 = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      continueEvent1.pathParameters = { storyId: testStoryId };

      const result1 = await continueEpisodeHandler(continueEvent1, mockContext);
      TestAssertions.expectValidAPIResponse(result1, 202);
      const response1 = JSON.parse(result1.body);
      expect(response1.episodeNumber).toBe(2);

      // Update mock to include episode 2
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
        TestDataFactory.createEpisode(testStoryId, 1),
        TestDataFactory.createEpisode(testStoryId, 2),
      ]);

      // Second continuation (episode 3)
      const continueEvent2 = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      continueEvent2.pathParameters = { storyId: testStoryId };

      const result2 = await continueEpisodeHandler(continueEvent2, mockContext);
      TestAssertions.expectValidAPIResponse(result2, 202);
      const response2 = JSON.parse(result2.body);
      expect(response2.episodeNumber).toBe(3);

      // Verify both requests were processed
      expect(mockGenerationRequestAccess.create).toHaveBeenCalledTimes(2);
    });

    it("should handle episode continuation for stories with gaps", async () => {
      // Mock episodes with gaps (missing episode 2)
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([
        TestDataFactory.createEpisode(testStoryId, 1),
        TestDataFactory.createEpisode(testStoryId, 3),
        TestDataFactory.createEpisode(testStoryId, 4),
      ]);

      const continueEvent = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      continueEvent.pathParameters = { storyId: testStoryId };

      const result = await continueEpisodeHandler(continueEvent, mockContext);

      TestAssertions.expectValidAPIResponse(result, 202);
      const response = JSON.parse(result.body);

      // Should create episode 5 (next after highest existing number)
      expect(response.episodeNumber).toBe(5);
    });
  });

  describe("Cross-Endpoint Integration", () => {
    it("should handle workflow start followed by episode continuation", async () => {
      // Step 1: Start workflow
      const workflowRequest = { numberOfStories: 1 };
      const workflowEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const workflowResult = await workflowHandler(workflowEvent, mockContext);
      TestAssertions.expectValidAPIResponse(workflowResult, 202);

      // Step 2: Continue episode for generated story
      const continueEvent = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      continueEvent.pathParameters = { storyId: testStoryId };

      const continueResult = await continueEpisodeHandler(continueEvent, mockContext);
      TestAssertions.expectValidAPIResponse(continueResult, 202);

      // Step 3: Check final content
      const contentEvent = APIGatewayEventFactory.createEvent(
        "GET",
        "/stories",
        null,
        testUserId
      );

      const contentResult = await contentRetrievalHandler(contentEvent, mockContext);
      TestAssertions.expectValidAPIResponse(contentResult, 200);

      // Verify both workflow and episode continuation were processed
      expect(mockEventPublisher).toHaveBeenCalledTimes(2);
    });

    it("should handle concurrent workflow and episode requests", async () => {
      const workflowRequest = { numberOfStories: 1 };
      const workflowEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const continueEvent = APIGatewayEventFactory.createEvent(
        "POST",
        `/stories/${testStoryId}/episodes`,
        null,
        testUserId
      );
      continueEvent.pathParameters = { storyId: testStoryId };

      // Run both requests concurrently
      const [workflowResult, continueResult] = await Promise.all([
        workflowHandler(workflowEvent, mockContext),
        continueEpisodeHandler(continueEvent, mockContext),
      ]);

      // Both should succeed
      TestAssertions.expectValidAPIResponse(workflowResult, 202);
      TestAssertions.expectValidAPIResponse(continueResult, 202);
    });
  });

  describe("Error Handling E2E", () => {
    it("should provide consistent error responses across endpoints", async () => {
      // Test unauthorized access
      const unauthorizedWorkflowEvent = APIGatewayEventFactory.createUnauthenticatedEvent(
        "POST",
        "/workflow/start",
        JSON.stringify({ numberOfStories: 1 })
      );

      const unauthorizedContinueEvent = APIGatewayEventFactory.createUnauthenticatedEvent(
        "POST",
        `/stories/${testStoryId}/episodes`
      );
      unauthorizedContinueEvent.pathParameters = { storyId: testStoryId };

      const [workflowResult, continueResult] = await Promise.all([
        workflowHandler(unauthorizedWorkflowEvent, mockContext),
        continueEpisodeHandler(unauthorizedContinueEvent, mockContext),
      ]);

      // Both should return consistent unauthorized responses
      TestAssertions.expectValidErrorResponse(workflowResult, "UNAUTHORIZED", 401);
      TestAssertions.expectValidErrorResponse(continueResult, "UNAUTHORIZED", 401);

      // Verify error response structure is consistent
      const workflowError = JSON.parse(workflowResult.body);
      const continueError = JSON.parse(continueResult.body);

      expect(workflowError.error).toHaveProperty("code");
      expect(workflowError.error).toHaveProperty("message");
      expect(workflowError.error).toHaveProperty("timestamp");

      expect(continueError.error).toHaveProperty("code");
      expect(continueError.error).toHaveProperty("message");
      expect(continueError.error).toHaveProperty("timestamp");
    });

    it("should handle validation errors consistently", async () => {
      // Invalid workflow request
      const invalidWorkflowEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify({ numberOfStories: 0 }), // Invalid
        testUserId
      );

      // Invalid continue episode request (missing story ID)
      const invalidContinueEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/stories//episodes", // Missing story ID
        null,
        testUserId
      );
      invalidContinueEvent.pathParameters = { storyId: "" };

      const [workflowResult, continueResult] = await Promise.all([
        workflowHandler(invalidWorkflowEvent, mockContext),
        continueEpisodeHandler(invalidContinueEvent, mockContext),
      ]);

      // Both should return validation errors
      TestAssertions.expectValidErrorResponse(workflowResult, "VALIDATION_ERROR", 400);
      TestAssertions.expectValidErrorResponse(continueResult, "VALIDATION_ERROR", 400);
    });
  });

  describe("Performance E2E", () => {
    it("should meet performance requirements for all endpoints", async () => {
      const performanceTests = [
        {
          name: "Workflow Start",
          testFn: () => {
            const event = APIGatewayEventFactory.createEvent(
              "POST",
              "/workflow/start",
              JSON.stringify({ numberOfStories: 1 }),
              testUserId
            );
            return workflowHandler(event, mockContext);
          },
          maxDuration: 3000,
        },
        {
          name: "Continue Episode",
          testFn: () => {
            const event = APIGatewayEventFactory.createEvent(
              "POST",
              `/stories/${testStoryId}/episodes`,
              null,
              testUserId
            );
            event.pathParameters = { storyId: testStoryId };
            return continueEpisodeHandler(event, mockContext);
          },
          maxDuration: 2000,
        },
        {
          name: "Status Check",
          testFn: () => {
            const event = APIGatewayEventFactory.createEvent(
              "GET",
              `/status/${testRequestId}`,
              null,
              testUserId
            );
            event.pathParameters = { requestId: testRequestId };
            return statusHandler(event, mockContext);
          },
          maxDuration: 1000,
        },
        {
          name: "Content Retrieval",
          testFn: () => {
            const event = APIGatewayEventFactory.createEvent(
              "GET",
              "/stories",
              null,
              testUserId
            );
            return contentRetrievalHandler(event, mockContext);
          },
          maxDuration: 2000,
        },
      ];

      for (const test of performanceTests) {
        const { result, duration } = await PerformanceTestUtils.measureExecutionTime(test.testFn);
        
        expect(result.statusCode).toBeLessThan(400); // Should not be an error
        expect(duration).toBeLessThan(test.maxDuration);
      }
    });

    it("should handle high concurrency across all endpoints", async () => {
      const concurrentTests = Array(20).fill(null).map((_, index) => {
        if (index % 4 === 0) {
          // Workflow start
          const event = APIGatewayEventFactory.createEvent(
            "POST",
            "/workflow/start",
            JSON.stringify({ numberOfStories: 1 }),
            `${testUserId}-${index}`
          );
          return workflowHandler(event, mockContext);
        } else if (index % 4 === 1) {
          // Continue episode
          const event = APIGatewayEventFactory.createEvent(
            "POST",
            `/stories/${testStoryId}/episodes`,
            null,
            `${testUserId}-${index}`
          );
          event.pathParameters = { storyId: testStoryId };
          return continueEpisodeHandler(event, mockContext);
        } else if (index % 4 === 2) {
          // Status check
          const event = APIGatewayEventFactory.createEvent(
            "GET",
            `/status/${testRequestId}`,
            null,
            `${testUserId}-${index}`
          );
          event.pathParameters = { requestId: testRequestId };
          return statusHandler(event, mockContext);
        } else {
          // Content retrieval
          const event = APIGatewayEventFactory.createEvent(
            "GET",
            "/stories",
            null,
            `${testUserId}-${index}`
          );
          return contentRetrievalHandler(event, mockContext);
        }
      });

      const results = await Promise.all(concurrentTests);

      // Most requests should succeed (accounting for rate limiting)
      const successfulResults = results.filter(r => r.statusCode < 400);
      expect(successfulResults.length).toBeGreaterThan(15);
    });
  });
});