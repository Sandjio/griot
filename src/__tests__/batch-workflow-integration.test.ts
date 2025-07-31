/**
 * Integration tests for batch workflow functionality
 * Tests complete batch workflow from start to completion
 * Requirements: 6A.3, 6A.4, 6A.6
 */

import { APIGatewayProxyEvent, EventBridgeEvent } from "aws-lambda";
import { handler as workflowHandler } from "../lambdas/workflow-orchestration/index";
import { handler as storyHandler } from "../lambdas/story-generation/index";
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

import {
  UserPreferencesAccess,
  GenerationRequestAccess,
  StoryAccess,
} from "../database/access-patterns";
import { EventPublisher } from "../utils/event-publisher";
import { S3Operations } from "../storage/s3-client";
import { BedrockClient } from "../lambdas/story-generation/bedrock-client";

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<typeof UserPreferencesAccess>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<typeof GenerationRequestAccess>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEventPublisher = EventPublisher as jest.MockedClass<typeof EventPublisher>;
const mockS3Operations = S3Operations as jest.Mocked<typeof S3Operations>;
const mockBedrockClient = BedrockClient as jest.MockedClass<typeof BedrockClient>;

describe("Batch Workflow Integration Tests", () => {
  const mockContext = LambdaContextFactory.createContext("batch-workflow");
  const testUserId = "batch-user-123";
  const testWorkflowId = "workflow-456";

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();
    setupBatchWorkflowMocks();
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  function setupBatchWorkflowMocks() {
    // User preferences mock
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: TestDataFactory.createUserPreferences(),
      insights: TestDataFactory.createQlooInsights(),
    });

    // Generation request mocks
    mockGenerationRequestAccess.create.mockResolvedValue();
    mockGenerationRequestAccess.updateStatus.mockResolvedValue();

    // Event publisher mock
    const mockEventPublisherInstance = {
      publishEvent: jest.fn().mockResolvedValue(),
    };
    mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

    // Story generation mocks
    const mockBedrockInstance = {
      generateStory: jest.fn().mockResolvedValue({
        title: "Generated Story",
        content: "Story content",
        metadata: { wordCount: 1000 },
      }),
    };
    mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

    // Storage mocks
    mockS3Operations.uploadText.mockResolvedValue("test-s3-key");
    mockStoryAccess.create.mockResolvedValue();
  }

  describe("Workflow Start Integration", () => {
    it("should start batch workflow with valid request", async () => {
      const workflowRequest = {
        numberOfStories: 3,
        batchSize: 1,
      };

      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const result = await workflowHandler(event, mockContext);

      TestAssertions.expectValidAPIResponse(result, 202);
      const response = JSON.parse(result.body);
      
      expect(response.workflowId).toBeDefined();
      expect(response.requestId).toBeDefined();
      expect(response.numberOfStories).toBe(3);
      expect(response.status).toBe("STARTED");
      expect(response.estimatedCompletionTime).toBeDefined();

      // Verify database operations
      expect(mockUserPreferencesAccess.getLatestWithMetadata).toHaveBeenCalledWith(testUserId);
      expect(mockGenerationRequestAccess.create).toHaveBeenCalled();

      // Verify event publishing
      const mockInstance = mockEventPublisher.mock.instances[0];
      expect(mockInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "manga.workflow",
          "detail-type": "Batch Story Generation Requested",
          detail: expect.objectContaining({
            userId: testUserId,
            numberOfStories: 3,
            currentBatch: 1,
            totalBatches: 3,
          }),
        })
      );
    });

    it("should reject workflow start without preferences", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: null,
        insights: null,
      });

      const workflowRequest = { numberOfStories: 2 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      const result = await workflowHandler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "PREFERENCES_NOT_FOUND", 400);
    });

    it("should validate numberOfStories parameter", async () => {
      const invalidRequests = [
        { numberOfStories: 0 },
        { numberOfStories: 11 },
        { numberOfStories: "invalid" },
        {},
      ];

      for (const request of invalidRequests) {
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(request),
          testUserId
        );

        const result = await workflowHandler(event, mockContext);
        TestAssertions.expectValidErrorResponse(result, "VALIDATION_ERROR", 400);
      }
    });

    it("should enforce rate limiting", async () => {
      const workflowRequest = { numberOfStories: 1 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      // Simulate multiple rapid requests
      const promises = Array(6).fill(null).map(() => 
        workflowHandler(event, mockContext)
      );

      const results = await Promise.all(promises);
      
      // At least one should be rate limited
      const rateLimitedResults = results.filter(r => r.statusCode === 429);
      expect(rateLimitedResults.length).toBeGreaterThan(0);
    });
  });

  describe("Sequential Story Generation", () => {
    it("should process stories sequentially in batch", async () => {
      const batchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
        version: "0",
        id: "test-event-id",
        "detail-type": "Batch Story Generation Requested",
        source: "manga.workflow",
        account: "123456789012",
        time: "2024-01-01T00:00:00Z",
        region: "us-east-1",
        resources: [],
        detail: {
          userId: testUserId,
          workflowId: testWorkflowId,
          requestId: "test-request-123",
          numberOfStories: 3,
          currentBatch: 1,
          totalBatches: 3,
          preferences: TestDataFactory.createUserPreferences(),
          insights: TestDataFactory.createQlooInsights(),
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      // Process first story
      await storyHandler(batchEvent, mockContext);

      // Verify story creation
      expect(mockStoryAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          title: "Generated Story",
          status: "COMPLETED",
        })
      );

      // Verify next batch event published
      const mockInstance = mockEventPublisher.mock.instances[0];
      expect(mockInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "manga.workflow",
          "detail-type": "Batch Story Generation Requested",
          detail: expect.objectContaining({
            currentBatch: 2,
            totalBatches: 3,
          }),
        })
      );
    });

    it("should handle story generation failure in batch", async () => {
      const mockBedrockInstance = {
        generateStory: jest.fn().mockRejectedValue(new Error("Generation failed")),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      const batchEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);
      batchEvent["detail-type"] = "Batch Story Generation Requested";
      batchEvent.detail.workflowId = testWorkflowId;
      batchEvent.detail.currentBatch = 1;
      batchEvent.detail.totalBatches = 3;

      await expect(storyHandler(batchEvent, mockContext)).rejects.toThrow("Generation failed");

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

    it("should complete batch workflow when all stories generated", async () => {
      const finalBatchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
        version: "0",
        id: "test-event-id",
        "detail-type": "Batch Story Generation Requested",
        source: "manga.workflow",
        account: "123456789012",
        time: "2024-01-01T00:00:00Z",
        region: "us-east-1",
        resources: [],
        detail: {
          userId: testUserId,
          workflowId: testWorkflowId,
          requestId: "test-request-123",
          numberOfStories: 3,
          currentBatch: 3,
          totalBatches: 3,
          preferences: TestDataFactory.createUserPreferences(),
          insights: TestDataFactory.createQlooInsights(),
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      await storyHandler(finalBatchEvent, mockContext);

      // Verify final story created
      expect(mockStoryAccess.create).toHaveBeenCalled();

      // Verify workflow completion event published
      const mockInstance = mockEventPublisher.mock.instances[0];
      expect(mockInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "manga.workflow",
          "detail-type": "Batch Workflow Completed",
        })
      );
    });
  });

  describe("Batch Progress Tracking", () => {
    it("should track progress throughout batch workflow", async () => {
      const workflowRequest = { numberOfStories: 5 };
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/workflow/start",
        JSON.stringify(workflowRequest),
        testUserId
      );

      // Start workflow
      const startResult = await workflowHandler(event, mockContext);
      expect(startResult.statusCode).toBe(202);

      const response = JSON.parse(startResult.body);
      const workflowId = response.workflowId;

      // Simulate progress through batches
      for (let batch = 1; batch <= 5; batch++) {
        const batchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
          version: "0",
          id: `test-event-${batch}`,
          "detail-type": "Batch Story Generation Requested",
          source: "manga.workflow",
          account: "123456789012",
          time: "2024-01-01T00:00:00Z",
          region: "us-east-1",
          resources: [],
          detail: {
            userId: testUserId,
            workflowId,
            requestId: response.requestId,
            numberOfStories: 5,
            currentBatch: batch,
            totalBatches: 5,
            preferences: TestDataFactory.createUserPreferences(),
            insights: TestDataFactory.createQlooInsights(),
            timestamp: "2024-01-01T00:00:00Z",
          },
        };

        await storyHandler(batchEvent, mockContext);
      }

      // Verify all stories were created
      expect(mockStoryAccess.create).toHaveBeenCalledTimes(5);

      // Verify progress tracking
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        testUserId,
        response.requestId,
        "COMPLETED",
        expect.objectContaining({
          completedStories: 5,
          totalStories: 5,
        })
      );
    });
  });

  describe("Error Recovery", () => {
    it("should continue batch processing after individual story failure", async () => {
      let callCount = 0;
      const mockBedrockInstance = {
        generateStory: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Second story failed");
          }
          return {
            title: `Generated Story ${callCount}`,
            content: "Story content",
            metadata: { wordCount: 1000 },
          };
        }),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      // Process 3 stories, second one fails
      for (let batch = 1; batch <= 3; batch++) {
        const batchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
          version: "0",
          id: `test-event-${batch}`,
          "detail-type": "Batch Story Generation Requested",
          source: "manga.workflow",
          account: "123456789012",
          time: "2024-01-01T00:00:00Z",
          region: "us-east-1",
          resources: [],
          detail: {
            userId: testUserId,
            workflowId: testWorkflowId,
            requestId: "test-request-123",
            numberOfStories: 3,
            currentBatch: batch,
            totalBatches: 3,
            preferences: TestDataFactory.createUserPreferences(),
            insights: TestDataFactory.createQlooInsights(),
            timestamp: "2024-01-01T00:00:00Z",
          },
        };

        if (batch === 2) {
          await expect(storyHandler(batchEvent, mockContext)).rejects.toThrow("Second story failed");
        } else {
          await storyHandler(batchEvent, mockContext);
        }
      }

      // Verify successful stories were still created
      expect(mockStoryAccess.create).toHaveBeenCalledTimes(2);
    });
  });
});