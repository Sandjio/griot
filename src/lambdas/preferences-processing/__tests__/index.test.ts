import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { handler } from "../index";
import {
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../../../database/access-patterns";
import { EventPublishingHelpers } from "../../../utils/event-publisher";
import { QlooApiClient } from "../qloo-client";
import { UserPreferencesData, QlooInsights } from "../../../types/data-models";

// Mock dependencies
jest.mock("../../../database/access-patterns");
jest.mock("../../../utils/event-publisher");
jest.mock("../qloo-client");
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-request-id-123"),
}));

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
const mockEventPublishingHelpers = EventPublishingHelpers as jest.Mocked<
  typeof EventPublishingHelpers
>;
const mockQlooApiClient = QlooApiClient as jest.MockedClass<
  typeof QlooApiClient
>;

describe("Preferences Processing Lambda", () => {
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "preferences-processing",
    functionVersion: "1",
    invokedFunctionArn:
      "arn:aws:lambda:us-east-1:123456789012:function:preferences-processing",
    memoryLimitInMB: "256",
    awsRequestId: "test-aws-request-id",
    logGroupName: "/aws/lambda/preferences-processing",
    logStreamName: "2023/01/01/[$LATEST]test-stream",
    getRemainingTimeInMillis: () => 30000,
  };

  const validPreferences: UserPreferencesData = {
    genres: ["Action", "Adventure"],
    themes: ["Friendship", "Good vs Evil"],
    artStyle: "Modern",
    targetAudience: "Young Adults",
    contentRating: "PG-13",
  };

  const mockInsights: QlooInsights = {
    recommendations: [
      {
        category: "Action",
        score: 0.9,
        attributes: { intensity: "high" },
      },
    ],
    trends: [
      {
        topic: "Isekai Adventures",
        popularity: 0.95,
      },
    ],
  };

  const createMockEvent = (
    body: string | null,
    userId: string = "test-user-123"
  ): APIGatewayProxyEvent => ({
    httpMethod: "POST",
    path: "/preferences",
    pathParameters: null,
    queryStringParameters: null,
    headers: {
      "Content-Type": "application/json",
    },
    body,
    isBase64Encoded: false,
    requestContext: {
      requestId: "test-request-id",
      stage: "test",
      resourceId: "test-resource",
      resourcePath: "/preferences",
      httpMethod: "POST",
      requestTime: "01/Jan/2023:00:00:00 +0000",
      requestTimeEpoch: 1672531200000,
      path: "/test/preferences",
      accountId: "123456789012",
      protocol: "HTTP/1.1",
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: "127.0.0.1",
        user: null,
        userAgent: "test-agent",
        userArn: null,
        clientCert: null,
      },
      authorizer: userId
        ? {
            claims: {
              sub: userId,
              email: "test@example.com",
            },
          }
        : undefined,
      apiId: "test-api-id",
    },
    resource: "/preferences",
    stageVariables: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockGenerationRequestAccess.create.mockResolvedValue();
    mockGenerationRequestAccess.updateStatus.mockResolvedValue();
    mockUserPreferencesAccess.create.mockResolvedValue();
    mockEventPublishingHelpers.publishStoryGeneration.mockResolvedValue();

    const mockQlooInstance = {
      fetchInsights: jest.fn().mockResolvedValue(mockInsights),
    };
    mockQlooApiClient.mockImplementation(() => mockQlooInstance as any);
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      const event = createMockEvent(JSON.stringify(validPreferences), "");
      event.requestContext.authorizer = undefined;

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        },
      });
    });
  });

  describe("Request Validation", () => {
    it("should return 400 when request body is missing", async () => {
      const event = createMockEvent(null);

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "INVALID_REQUEST",
          message: "Request body is required",
        },
      });
    });

    it("should return 400 when request body is invalid JSON", async () => {
      const event = createMockEvent("invalid json");

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "INVALID_JSON",
          message: "Invalid JSON in request body",
        },
      });
    });

    it("should return 400 when preferences validation fails", async () => {
      const invalidPreferences = {
        genres: [], // Empty array should fail validation
        themes: ["Friendship"],
        artStyle: "Modern",
        targetAudience: "Young Adults",
        contentRating: "PG-13",
      };
      const event = createMockEvent(JSON.stringify(invalidPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
        },
      });
    });
  });

  describe("Successful Processing", () => {
    it("should process preferences successfully", async () => {
      const event = createMockEvent(JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toMatchObject({
        success: true,
        data: {
          requestId: "test-request-id-123",
          status: "PROCESSING",
          message:
            "Preferences submitted successfully. Story generation has been initiated.",
          estimatedCompletionTime: "2-3 minutes",
        },
      });

      // Verify all operations were called
      expect(mockGenerationRequestAccess.create).toHaveBeenCalledWith({
        requestId: "test-request-id-123",
        userId: "test-user-123",
        type: "STORY",
        status: "PENDING",
        createdAt: expect.any(String),
      });

      expect(mockUserPreferencesAccess.create).toHaveBeenCalledWith(
        "test-user-123",
        {
          preferences: validPreferences,
          insights: mockInsights,
        }
      );

      expect(
        mockEventPublishingHelpers.publishStoryGeneration
      ).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-id-123",
        validPreferences,
        mockInsights
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle Qloo API errors", async () => {
      const mockQlooInstance = {
        fetchInsights: jest.fn().mockRejectedValue(new Error("Qloo API error")),
      };
      mockQlooApiClient.mockImplementation(() => mockQlooInstance as any);

      const event = createMockEvent(JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "QLOO_API_ERROR",
          message:
            "Failed to process user preferences. Please try again later.",
        },
      });

      // Verify request status was updated to failed
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-id-123",
        "FAILED",
        {
          errorMessage: "Failed to fetch user insights from Qloo API",
        }
      );
    });

    it("should handle database errors when storing preferences", async () => {
      mockUserPreferencesAccess.create.mockRejectedValue(
        new Error("Database error")
      );

      const event = createMockEvent(JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to save preferences. Please try again later.",
        },
      });

      // Verify request status was updated to failed
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-id-123",
        "FAILED",
        {
          errorMessage: "Failed to store user preferences",
        }
      );
    });

    it("should handle event publishing errors", async () => {
      mockEventPublishingHelpers.publishStoryGeneration.mockRejectedValue(
        new Error("Event publishing error")
      );

      const event = createMockEvent(JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "EVENT_PUBLISHING_ERROR",
          message:
            "Failed to initiate story generation. Please try again later.",
        },
      });

      // Verify request status was updated to failed
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        "test-user-123",
        "test-request-id-123",
        "FAILED",
        {
          errorMessage: "Failed to initiate story generation",
        }
      );
    });

    it("should handle unexpected errors", async () => {
      mockGenerationRequestAccess.create.mockRejectedValue(
        new Error("Unexpected error")
      );

      const event = createMockEvent(JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred. Please try again later.",
        },
      });
    });
  });

  describe("CORS Headers", () => {
    it("should include CORS headers in all responses", async () => {
      const event = createMockEvent(JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.headers).toMatchObject({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      });
    });
  });
});
