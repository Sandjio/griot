import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { handler } from "../index";
import { UserPreferencesAccess } from "../../../database/access-patterns";
import { QlooApiClient } from "../qloo-client";
import {
  UserPreferencesData,
  QlooInsights,
  UserPreferences,
} from "../../../types/data-models";

// Mock dependencies
jest.mock("../../../database/access-patterns");
jest.mock("../qloo-client");
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-request-id-123"),
}));

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
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

  const mockUserPreferencesData: UserPreferences = {
    PK: "USER#test-user-123",
    SK: "PREFERENCES#2023-01-01T00:00:00.000Z",
    GSI1PK: "USER#test-user-123",
    GSI1SK: "PREFERENCES#2023-01-01T00:00:00.000Z",
    createdAt: "2023-01-01T00:00:00.000Z",
    preferences: validPreferences,
    insights: mockInsights,
  };

  const createMockEvent = (
    httpMethod: string = "POST",
    body: string | null = null,
    userId: string = "test-user-123"
  ): APIGatewayProxyEvent => ({
    httpMethod,
    path: "/preferences",
    pathParameters: null,
    queryStringParameters: null,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "test-agent",
    },
    body,
    isBase64Encoded: false,
    requestContext: {
      requestId: "test-request-id",
      stage: "test",
      resourceId: "test-resource",
      resourcePath: "/preferences",
      httpMethod,
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
    mockUserPreferencesAccess.create.mockResolvedValue();
    mockUserPreferencesAccess.getLatest.mockResolvedValue(
      mockUserPreferencesData
    );

    const mockQlooInstance = {
      fetchInsights: jest.fn().mockResolvedValue(mockInsights),
    };
    mockQlooApiClient.mockImplementation(() => mockQlooInstance as any);
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated for POST", async () => {
      const event = createMockEvent(
        "POST",
        JSON.stringify(validPreferences),
        ""
      );
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

    it("should return 401 when user is not authenticated for GET", async () => {
      const event = createMockEvent("GET", null, "");
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

  describe("Method Routing", () => {
    it("should return 405 for unsupported HTTP methods", async () => {
      const event = createMockEvent("DELETE", null);

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(405);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "HTTP method DELETE is not supported",
        },
      });
    });
  });

  describe("GET Endpoint", () => {
    it("should retrieve user preferences successfully", async () => {
      const event = createMockEvent("GET");

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockUserPreferencesAccess.getLatest).toHaveBeenCalledWith(
        "test-user-123"
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toMatchObject({
        success: true,
        data: {
          preferences: validPreferences,
          insights: mockInsights,
          lastUpdated: "2023-01-01T00:00:00.000Z",
        },
      });
    });

    it("should return empty response when user has no preferences", async () => {
      mockUserPreferencesAccess.getLatest.mockResolvedValue(null);
      const event = createMockEvent("GET");

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockUserPreferencesAccess.getLatest).toHaveBeenCalledWith(
        "test-user-123"
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toMatchObject({
        success: true,
        data: {
          preferences: null,
          message: "No preferences found for user",
        },
      });
    });

    it("should handle database errors when retrieving preferences", async () => {
      mockUserPreferencesAccess.getLatest.mockRejectedValue(
        new Error("Database error")
      );
      const event = createMockEvent("GET");

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to retrieve preferences. Please try again later.",
        },
      });
    });
  });

  describe("POST Endpoint - Request Validation", () => {
    it("should return 400 when request body is missing", async () => {
      const event = createMockEvent("POST", null);

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
      const event = createMockEvent("POST", "invalid json");

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
      const event = createMockEvent("POST", JSON.stringify(invalidPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
        },
      });
    });
  });

  describe("POST Endpoint - Successful Processing", () => {
    it("should process preferences successfully without EventBridge integration", async () => {
      const event = createMockEvent("POST", JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toMatchObject({
        success: true,
        data: {
          message: "Preferences saved successfully",
          preferences: validPreferences,
          insights: mockInsights,
        },
      });

      // Verify preferences were stored
      expect(mockUserPreferencesAccess.create).toHaveBeenCalledWith(
        "test-user-123",
        {
          preferences: validPreferences,
          insights: mockInsights,
        }
      );

      // Verify EventBridge integration is NOT called (removed functionality)
      // No assertions for EventPublishingHelpers or GenerationRequestAccess
    });
  });

  describe("POST Endpoint - Error Handling", () => {
    it("should handle Qloo API errors", async () => {
      const mockQlooInstance = {
        fetchInsights: jest.fn().mockRejectedValue(new Error("Qloo API error")),
      };
      mockQlooApiClient.mockImplementation(() => mockQlooInstance as any);

      const event = createMockEvent("POST", JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "QLOO_API_ERROR",
          message:
            "Failed to process user preferences. Please try again later.",
        },
      });
    });

    it("should handle database errors when storing preferences", async () => {
      mockUserPreferencesAccess.create.mockRejectedValue(
        new Error("Database error")
      );

      const event = createMockEvent("POST", JSON.stringify(validPreferences));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to save preferences. Please try again later.",
        },
      });
    });
  });

  describe("CORS Headers", () => {
    it("should include CORS headers in all responses", async () => {
      const event = createMockEvent("GET", null, "unique-user-for-cors-test");

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
