import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handler } from "../workflow-orchestration/index";
import {
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../../database/access-patterns";
import { EventPublisher } from "../../utils/event-publisher";
import { RateLimiter } from "../../utils/input-validation";

// Mock dependencies
jest.mock("../../database/access-patterns");
jest.mock("../../utils/event-publisher");
jest.mock("../../utils/cloudwatch-metrics");
jest.mock("../../utils/input-validation", () => ({
  ...jest.requireActual("../../utils/input-validation"),
  RateLimiter: {
    isAllowed: jest.fn().mockReturnValue(true),
  },
}));
jest.mock("aws-xray-sdk-core", () => ({
  getSegment: () => ({
    addNewSubsegment: () => ({
      addAnnotation: jest.fn(),
      addMetadata: jest.fn(),
      addError: jest.fn(),
      close: jest.fn(),
    }),
  }),
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
const mockRateLimiter = RateLimiter as jest.Mocked<typeof RateLimiter>;

describe("Workflow Start Integration Tests", () => {
  const mockUserId = "test-user-123";
  const mockRequestId = "test-request-123";

  const createMockEvent = (
    body: any,
    httpMethod: string = "POST",
    path: string = "/workflow/start"
  ): APIGatewayProxyEvent =>
    ({
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
            email: "test@example.com",
          },
        },
        identity: {
          sourceIp: "127.0.0.1",
        },
      } as any,
    } as APIGatewayProxyEvent);

  const mockPreferences = {
    genres: ["Action", "Adventure"],
    themes: ["Friendship", "Growth"],
    artStyle: "Modern",
    targetAudience: "Young Adults",
    contentRating: "PG-13",
  };

  const mockInsights = {
    recommendations: [
      {
        category: "genre",
        score: 0.8,
        attributes: { popularity: "high" },
      },
    ],
    trends: [
      {
        topic: "adventure",
        popularity: 0.9,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: mockPreferences,
      insights: mockInsights,
    });

    mockGenerationRequestAccess.create.mockResolvedValue(undefined);

    const mockPublishEvent = jest.fn().mockResolvedValue(undefined);
    mockEventPublisher.mockImplementation(
      () =>
        ({
          publishEvent: mockPublishEvent,
        } as any)
    );
  });

  describe("POST /workflow/start - Success Cases", () => {
    it("should successfully start workflow with valid request", async () => {
      const event = createMockEvent({
        numberOfStories: 3,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

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
      expect(responseBody.timestamp).toBeDefined();

      // Verify database calls
      expect(
        mockUserPreferencesAccess.getLatestWithMetadata
      ).toHaveBeenCalledWith(mockUserId);
      expect(mockGenerationRequestAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          type: "STORY",
          status: "PROCESSING",
        })
      );

      // Verify event publishing
      expect(mockEventPublisher).toHaveBeenCalled();
    });

    it("should handle optional batchSize parameter", async () => {
      const event = createMockEvent({
        numberOfStories: 2,
        batchSize: 1,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(202);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.numberOfStories).toBe(2);
    });

    it("should include proper CORS and security headers", async () => {
      const event = createMockEvent({
        numberOfStories: 1,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.headers).toMatchObject({
        "Content-Type": "application/json",
        "X-Request-ID": mockRequestId,
      });
    });
  });

  describe("POST /workflow/start - Validation Errors", () => {
    it("should return 400 for missing numberOfStories", async () => {
      const event = createMockEvent({});

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
      expect(responseBody.error.message).toContain("numberOfStories");
    });

    it("should return 400 for numberOfStories below minimum", async () => {
      const event = createMockEvent({
        numberOfStories: 0,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 for numberOfStories above maximum", async () => {
      const event = createMockEvent({
        numberOfStories: 15,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 for invalid batchSize", async () => {
      const event = createMockEvent({
        numberOfStories: 3,
        batchSize: 10,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 for missing request body", async () => {
      const event = createMockEvent(null);
      event.body = null;

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("MISSING_BODY");
    });

    it("should return 400 for invalid JSON", async () => {
      const event = createMockEvent({});
      event.body = "invalid json";

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("INVALID_JSON");
    });
  });

  describe("POST /workflow/start - Authentication Errors", () => {
    it("should return 401 for missing user authentication", async () => {
      const event = createMockEvent({
        numberOfStories: 3,
      });
      event.requestContext.authorizer = undefined;

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(401);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("UNAUTHORIZED");
    });

    it("should return 401 for missing user ID in claims", async () => {
      const event = createMockEvent({
        numberOfStories: 3,
      });
      event.requestContext.authorizer!.claims.sub = "";

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(401);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("POST /workflow/start - Business Logic Errors", () => {
    it("should return 400 when user preferences not found", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: null,
        insights: null,
      });

      const event = createMockEvent({
        numberOfStories: 3,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(400);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("PREFERENCES_NOT_FOUND");
      expect(responseBody.error.message).toContain("preferences not found");
    });
  });

  describe("POST /workflow/start - HTTP Method Validation", () => {
    it("should return 405 for GET method", async () => {
      const event = createMockEvent(
        {
          numberOfStories: 3,
        },
        "GET"
      );

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(405);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("METHOD_NOT_ALLOWED");
      expect(result.headers?.Allow).toBe("POST");
    });

    it("should return 405 for PUT method", async () => {
      const event = createMockEvent(
        {
          numberOfStories: 3,
        },
        "PUT"
      );

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(405);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("METHOD_NOT_ALLOWED");
    });
  });

  describe("POST /workflow/start - Database Error Handling", () => {
    it("should return 500 when preferences retrieval fails", async () => {
      mockUserPreferencesAccess.getLatestWithMetadata.mockRejectedValue(
        new Error("Database connection failed")
      );

      const event = createMockEvent({
        numberOfStories: 3,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(500);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("INTERNAL_ERROR");
    });

    it("should return 500 when request creation fails", async () => {
      mockGenerationRequestAccess.create.mockRejectedValue(
        new Error("Failed to create request")
      );

      const event = createMockEvent({
        numberOfStories: 3,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(500);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("POST /workflow/start - Event Publishing", () => {
    it("should publish correct batch workflow event", async () => {
      const mockPublishEvent = jest.fn().mockResolvedValue(undefined);
      mockEventPublisher.mockImplementation(
        () =>
          ({
            publishEvent: mockPublishEvent,
          } as any)
      );

      const event = createMockEvent({
        numberOfStories: 3,
      });

      await handler(event, {} as any);

      expect(mockPublishEvent).toHaveBeenCalledWith({
        source: "manga.workflow",
        "detail-type": "Batch Story Generation Requested",
        detail: expect.objectContaining({
          userId: mockUserId,
          numberOfStories: 3,
          currentBatch: 1,
          totalBatches: 3,
          preferences: mockPreferences,
          insights: mockInsights,
        }),
      });
    });

    it("should handle event publishing failure", async () => {
      const mockPublishEvent = jest
        .fn()
        .mockRejectedValue(new Error("EventBridge publish failed"));
      mockEventPublisher.mockImplementation(
        () =>
          ({
            publishEvent: mockPublishEvent,
          } as any)
      );

      const event = createMockEvent({
        numberOfStories: 3,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(500);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("POST /workflow/start - Rate Limiting", () => {
    it("should handle rate limiting properly", async () => {
      // Mock rate limiter to return false (rate limited)
      mockRateLimiter.isAllowed.mockReturnValueOnce(false);

      const event = createMockEvent({
        numberOfStories: 3,
      });

      const result: APIGatewayProxyResult = await handler(event, {} as any);

      expect(result.statusCode).toBe(429);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(result.headers?.["Retry-After"]).toBe("300");
    });
  });
});
