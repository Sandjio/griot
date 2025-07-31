/**
 * Unit Tests for Workflow Orchestration Lambda Function
 *
 * Tests the batch manga generation workflow orchestration functionality
 * including request validation, user preference retrieval, and event publishing.
 *
 * Requirements: 6A.1, 6A.2, 6A.3, 6A.4, 6A.5
 */

import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { handler } from "../index";
import {
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../../../database/access-patterns";
import { EventPublisher } from "../../../utils/event-publisher";
import { BusinessMetrics } from "../../../utils/cloudwatch-metrics";

// Mock dependencies
jest.mock("../../../database/access-patterns");
jest.mock("../../../utils/event-publisher");
jest.mock("../../../utils/cloudwatch-metrics");
jest.mock("../../../utils/input-validation", () => ({
  ...jest.requireActual("../../../utils/input-validation"),
  RateLimiter: {
    isAllowed: jest.fn(() => true), // Default to allowing requests
  },
}));
jest.mock("aws-xray-sdk-core", () => ({
  getSegment: jest.fn(() => ({
    addNewSubsegment: jest.fn(() => ({
      addAnnotation: jest.fn(),
      addMetadata: jest.fn(),
      addError: jest.fn(),
      close: jest.fn(),
    })),
  })),
}));

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
const mockEventPublisher = EventPublisher as jest.MockedClass<
  typeof EventPublisher
>;
const mockBusinessMetrics = BusinessMetrics as jest.Mocked<
  typeof BusinessMetrics
>;

// Test data
const mockUserId = "test-user-123";
const mockEmail = "test@example.com";
const mockRequestId = "test-request-123";

const mockUserPreferences = {
  genres: ["action", "adventure"],
  themes: ["friendship", "courage"],
  artStyle: "manga",
  targetAudience: "teen",
  contentRating: "PG-13",
};

const mockQlooInsights = {
  recommendations: [
    {
      category: "genre",
      score: 0.9,
      attributes: { popularity: "high" },
    },
  ],
  trends: [
    {
      topic: "adventure",
      popularity: 0.8,
    },
  ],
};

const createMockEvent = (
  body: any,
  httpMethod: string = "POST",
  path: string = "/workflow/start"
): APIGatewayProxyEvent => ({
  httpMethod,
  path,
  body: JSON.stringify(body),
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "test-agent",
  },
  requestContext: {
    requestId: mockRequestId,
    authorizer: {
      claims: {
        sub: mockUserId,
        email: mockEmail,
      },
    },
    identity: {
      sourceIp: "127.0.0.1",
    },
  } as any,
  queryStringParameters: null,
  pathParameters: null,
  multiValueHeaders: {},
  multiValueQueryStringParameters: null,
  stageVariables: null,
  isBase64Encoded: false,
  resource: "",
});

const createMockContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: false,
  functionName: "workflow-orchestration",
  functionVersion: "1",
  invokedFunctionArn:
    "arn:aws:lambda:us-east-1:123456789012:function:workflow-orchestration",
  memoryLimitInMB: "256",
  awsRequestId: "test-aws-request-id",
  logGroupName: "/aws/lambda/workflow-orchestration",
  logStreamName: "test-log-stream",
  getRemainingTimeInMillis: () => 30000,
  done: jest.fn(),
  fail: jest.fn(),
  succeed: jest.fn(),
});

describe("Workflow Orchestration Lambda", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset rate limiter mock to default (allow requests)
    const { RateLimiter } = require("../../../utils/input-validation");
    RateLimiter.isAllowed.mockReturnValue(true);

    // Setup default mocks
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: mockUserPreferences,
      insights: mockQlooInsights,
    });

    mockGenerationRequestAccess.create.mockResolvedValue();

    const mockEventPublisherInstance = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };
    mockEventPublisher.mockImplementation(
      () => mockEventPublisherInstance as any
    );

    // Store the instance for test access
    (mockEventPublisher as any).mockInstance = mockEventPublisherInstance;

    mockBusinessMetrics.recordWorkflowStart.mockResolvedValue();
  });

  describe("POST /workflow/start", () => {
    it("should successfully start a batch workflow with valid request", async () => {
      const requestBody = {
        numberOfStories: 3,
        batchSize: 1,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(202);

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toMatchObject({
        numberOfStories: 3,
        status: "STARTED",
        message: "Batch workflow started successfully",
      });
      expect(responseBody.workflowId).toBeDefined();
      expect(responseBody.requestId).toBeDefined();
      expect(responseBody.estimatedCompletionTime).toBeDefined();

      // Verify user preferences were retrieved
      expect(
        mockUserPreferencesAccess.getLatestWithMetadata
      ).toHaveBeenCalledWith(mockUserId);

      // Verify generation request was created
      expect(mockGenerationRequestAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          type: "STORY",
          status: "PROCESSING",
        })
      );

      // Verify event was published
      const mockEventPublisherInstance = (mockEventPublisher as any)
        .mockInstance;
      expect(mockEventPublisherInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "manga.workflow",
          "detail-type": "Batch Story Generation Requested",
          detail: expect.objectContaining({
            userId: mockUserId,
            numberOfStories: 3,
            currentBatch: 1,
            totalBatches: 3,
            preferences: mockUserPreferences,
            insights: mockQlooInsights,
          }),
        })
      );

      // Verify metrics were recorded
      expect(mockBusinessMetrics.recordWorkflowStart).toHaveBeenCalledWith(
        mockUserId,
        3
      );
    });

    it("should use default batch size of 1 when not provided", async () => {
      const requestBody = {
        numberOfStories: 2,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(202);

      const mockEventPublisherInstance = (mockEventPublisher as any)
        .mockInstance;
      expect(mockEventPublisherInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            totalBatches: 2, // numberOfStories / batchSize (1)
          }),
        })
      );
    });

    it("should return 400 when numberOfStories is missing", async () => {
      const requestBody = {};

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
      expect(responseBody.error.message).toContain("numberOfStories");
    });

    it("should return 400 when numberOfStories is not a number", async () => {
      const requestBody = {
        numberOfStories: "invalid",
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
      expect(responseBody.error.message).toContain(
        "numberOfStories must be of type number"
      );
    });

    it("should return 400 when numberOfStories is less than 1", async () => {
      const requestBody = {
        numberOfStories: 0,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
      expect(responseBody.error.message).toContain(
        "numberOfStories must be at least 1"
      );
    });

    it("should return 400 when numberOfStories exceeds maximum", async () => {
      const requestBody = {
        numberOfStories: 15,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
      expect(responseBody.error.message).toContain(
        "numberOfStories must be no more than 10"
      );
    });

    it("should return 400 when batchSize is invalid", async () => {
      const requestBody = {
        numberOfStories: 3,
        batchSize: 0,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
      expect(responseBody.error.message).toContain(
        "batchSize must be at least 1"
      );
    });

    it("should return 400 when user preferences are not found", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: null,
        insights: null,
      });

      const requestBody = {
        numberOfStories: 2,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("PREFERENCES_NOT_FOUND");
      expect(responseBody.error.message).toContain(
        "User preferences not found"
      );
    });

    it("should return 401 when user is not authenticated", async () => {
      const requestBody = {
        numberOfStories: 2,
      };

      const event = createMockEvent(requestBody);
      // Remove authorization
      delete event.requestContext.authorizer;

      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(401);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 405 for non-POST methods", async () => {
      const requestBody = {
        numberOfStories: 2,
      };

      const event = createMockEvent(requestBody, "GET");
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(405);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("METHOD_NOT_ALLOWED");
      expect(result.headers?.Allow).toBe("POST");
    });

    it("should return 400 when request body is missing", async () => {
      const event = createMockEvent(null);
      event.body = null;

      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("MISSING_BODY");
    });

    it("should return 400 when request body is invalid JSON", async () => {
      const event = createMockEvent(null);
      event.body = "invalid json";

      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("INVALID_JSON");
    });

    it("should handle database errors gracefully", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockRejectedValue(
        new Error("Database connection failed")
      );

      const requestBody = {
        numberOfStories: 2,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(500);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("INTERNAL_ERROR");
    });

    it("should handle event publishing errors gracefully", async () => {
      const mockEventPublisherInstance = {
        publishEvent: jest
          .fn()
          .mockRejectedValue(new Error("EventBridge error")),
      };
      mockEventPublisher.mockImplementation(
        () => mockEventPublisherInstance as any
      );

      const requestBody = {
        numberOfStories: 2,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(500);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("INTERNAL_ERROR");
    });

    it("should calculate correct total batches for sequential processing", async () => {
      const requestBody = {
        numberOfStories: 5,
        batchSize: 1, // Sequential processing
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(202);

      const mockEventPublisherInstance = (mockEventPublisher as any)
        .mockInstance;
      expect(mockEventPublisherInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            numberOfStories: 5,
            currentBatch: 1,
            totalBatches: 5, // Math.ceil(5 / 1) = 5
          }),
        })
      );
    });

    it("should include security headers in response", async () => {
      const requestBody = {
        numberOfStories: 2,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.headers).toMatchObject({
        "Content-Type": "application/json",
        "X-Request-ID": mockRequestId,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "Content-Security-Policy":
          "default-src 'none'; frame-ancestors 'none';",
      });
    });

    it("should work with insights when available", async () => {
      const requestBody = {
        numberOfStories: 1,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(202);

      const mockEventPublisherInstance = (mockEventPublisher as any)
        .mockInstance;
      expect(mockEventPublisherInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            insights: mockQlooInsights,
          }),
        })
      );
    });

    it("should work without insights when not available", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: mockUserPreferences,
        insights: null,
      });

      const requestBody = {
        numberOfStories: 1,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(202);

      const mockEventPublisherInstance = (mockEventPublisher as any)
        .mockInstance;
      expect(mockEventPublisherInstance.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            insights: {},
          }),
        })
      );
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce rate limiting for workflow starts", async () => {
      // Mock rate limiter to return false (rate limit exceeded)
      const RateLimiter =
        require("../../../utils/input-validation").RateLimiter;
      jest.spyOn(RateLimiter, "isAllowed").mockReturnValue(false);

      const requestBody = {
        numberOfStories: 2,
      };

      const event = createMockEvent(requestBody);
      const context = createMockContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(429);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(result.headers?.["Retry-After"]).toBe("300");
    });
  });
});
