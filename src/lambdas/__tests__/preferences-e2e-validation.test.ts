import { handler as preferencesHandler } from "../preferences-processing/index";
import { UserPreferencesAccess } from "../../database/access-patterns";
import { QlooApiClient } from "../preferences-processing/qloo-client";
import { validatePreferences } from "../preferences-processing/validation";
import { APIGatewayProxyEvent, Context } from "aws-lambda";

// Mock external dependencies
jest.mock("../../database/access-patterns");
jest.mock("../preferences-processing/qloo-client");
jest.mock("../preferences-processing/validation");
jest.mock("aws-xray-sdk-core", () => ({
  getSegment: jest.fn(() => ({
    addNewSubsegment: jest.fn(() => ({
      addAnnotation: jest.fn(),
      addMetadata: jest.fn(),
      addError: jest.fn(),
      close: jest.fn(),
    })),
    addAnnotation: jest.fn(),
    addMetadata: jest.fn(),
    addError: jest.fn(),
    close: jest.fn(),
  })),
}));
jest.mock("../../utils/error-handler", () => ({
  withErrorHandling: jest.fn((handler) => handler),
  ErrorLogger: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));
jest.mock("../../utils/cloudwatch-metrics", () => ({
  BusinessMetrics: {
    recordPreferenceSubmission: jest.fn(),
  },
  PerformanceTimer: jest.fn().mockImplementation(() => ({
    stop: jest.fn(() => 100),
  })),
}));
jest.mock("../../utils/input-validation", () => ({
  validateApiGatewayEvent: jest.fn(() => ({ isValid: true, errors: [] })),
  InputValidator: {
    validate: jest.fn(() => ({
      isValid: true,
      errors: [],
      sanitizedData: {},
    })),
  },
  PREFERENCES_VALIDATION_RULES: {},
  RateLimiter: {
    isAllowed: jest.fn(() => true),
  },
  SECURITY_HEADERS: {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  },
}));

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
>;
const mockQlooApiClient = QlooApiClient as jest.MockedClass<
  typeof QlooApiClient
>;
const mockValidatePreferences = validatePreferences as jest.MockedFunction<
  typeof validatePreferences
>;

describe("Preferences API End-to-End Validation Tests", () => {
  // Set up environment variables
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      QLOO_API_URL: "https://test-qloo-api.com",
      QLOO_API_KEY: "test-api-key",
      QLOO_API_TIMEOUT: "10000",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const mockUserId = "test-user-123";
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

  const validPreferences = {
    genres: ["Action", "Adventure"],
    themes: ["Friendship", "Good vs Evil"],
    artStyle: "Traditional",
    targetAudience: "Teens",
    contentRating: "PG-13",
  };

  const mockInsights = {
    recommendations: [
      {
        category: "genre",
        score: 0.9,
        attributes: { popularity: "high", trending: true },
      },
    ],
    trends: [{ topic: "superhero", popularity: 85 }],
  };

  const createMockEvent = (
    httpMethod: string,
    body: string | null = null,
    userId: string = mockUserId
  ): APIGatewayProxyEvent => ({
    httpMethod,
    path: "/preferences",
    pathParameters: null,
    queryStringParameters: null,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-jwt-token",
    },
    body,
    isBase64Encoded: false,
    requestContext: {
      requestId: "e2e-test-request-id",
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
        userAgent: "e2e-test-agent",
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

  let mockQlooInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset validation mock to default
    mockValidatePreferences.mockReturnValue({ isValid: true, errors: [] });

    // Setup default mocks
    mockUserPreferencesAccess.create.mockResolvedValue();
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: validPreferences,
      insights: mockInsights,
      lastUpdated: "2023-01-01T00:00:00.000Z",
    });

    // Setup Qloo API client mock
    mockQlooInstance = {
      fetchInsights: jest.fn().mockResolvedValue(mockInsights),
    };
    mockQlooApiClient.mockImplementation(() => mockQlooInstance);

    // Reset input validation mocks
    const { InputValidator } = require("../../utils/input-validation");
    InputValidator.validate.mockImplementation((data: any) => ({
      isValid: true,
      errors: [],
      sanitizedData: data,
    }));

    // Reset other utility mocks
    const { BusinessMetrics } = require("../../utils/cloudwatch-metrics");
    BusinessMetrics.recordPreferenceSubmission.mockResolvedValue();
  });

  describe("Task 10.1: End-to-End Testing", () => {
    describe("Complete User Preference Submission Flow (POST)", () => {
      it("should complete the full POST workflow without EventBridge integration", async () => {
        // Requirements: 1.1, 2.1, 4.1, 4.2
        const event = createMockEvent("POST", JSON.stringify(validPreferences));

        const result = await preferencesHandler(event, mockContext);

        // Verify successful response
        expect(result.statusCode).toBe(200);
        expect(result.headers).toMatchObject({
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });

        const response = JSON.parse(result.body);
        expect(response).toMatchObject({
          success: true,
          data: {
            message: "Preferences saved successfully",
            preferences: validPreferences,
            insights: mockInsights,
          },
          requestId: "e2e-test-request-id",
          timestamp: expect.any(String),
        });

        // Verify all integration steps were executed
        expect(mockQlooInstance.fetchInsights).toHaveBeenCalledWith(
          validPreferences
        );
        expect(mockUserPreferencesAccess.create).toHaveBeenCalledWith(
          mockUserId,
          {
            preferences: validPreferences,
            insights: mockInsights,
          }
        );
      });

      it("should handle POST workflow validation errors", async () => {
        const invalidPreferences = {
          genres: [], // Invalid: empty array
          themes: ["ValidTheme"],
          artStyle: "InvalidStyle",
          targetAudience: "Teens",
          contentRating: "PG-13",
        };

        mockValidatePreferences.mockReturnValueOnce({
          isValid: false,
          errors: ["At least one genre must be selected"],
        });

        const event = createMockEvent(
          "POST",
          JSON.stringify(invalidPreferences)
        );
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(400);
        const response = JSON.parse(result.body);
        expect(response.error).toMatchObject({
          code: "VALIDATION_ERROR",
          message: expect.stringContaining(
            "At least one genre must be selected"
          ),
        });

        // Verify no downstream operations were attempted
        expect(mockQlooInstance.fetchInsights).not.toHaveBeenCalled();
        expect(mockUserPreferencesAccess.create).not.toHaveBeenCalled();
      });

      it("should handle POST workflow Qloo API failures", async () => {
        mockQlooInstance.fetchInsights.mockRejectedValue(
          new Error("Qloo API error")
        );

        const event = createMockEvent("POST", JSON.stringify(validPreferences));
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(500);
        const response = JSON.parse(result.body);
        expect(response.error).toMatchObject({
          code: "QLOO_API_ERROR",
          message:
            "Failed to process user preferences. Please try again later.",
        });

        // Verify preferences were not stored due to Qloo failure
        expect(mockUserPreferencesAccess.create).not.toHaveBeenCalled();
      });

      it("should handle POST workflow database failures", async () => {
        mockUserPreferencesAccess.create.mockRejectedValue(
          new Error("Database write failed")
        );

        const event = createMockEvent("POST", JSON.stringify(validPreferences));
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(500);
        const response = JSON.parse(result.body);
        expect(response.error).toMatchObject({
          code: "PREFERENCES_STORAGE_ERROR",
          message: "Failed to save preferences. Please try again later.",
        });
      });
    });

    describe("Complete User Preference Retrieval Flow (GET)", () => {
      it("should complete the full GET workflow", async () => {
        // Requirements: 2.1
        const event = createMockEvent("GET");

        const result = await preferencesHandler(event, mockContext);

        // Verify successful response
        expect(result.statusCode).toBe(200);
        expect(result.headers).toMatchObject({
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });

        const response = JSON.parse(result.body);
        expect(response).toMatchObject({
          success: true,
          data: {
            preferences: validPreferences,
            insights: mockInsights,
            lastUpdated: "2023-01-01T00:00:00.000Z",
          },
          requestId: "e2e-test-request-id",
          timestamp: expect.any(String),
        });

        // Verify database access
        expect(
          mockUserPreferencesAccess.getLatestWithMetadata
        ).toHaveBeenCalledWith(mockUserId);
      });

      it("should handle GET workflow when user has no preferences", async () => {
        mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
          preferences: null,
        });

        const event = createMockEvent("GET");
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        expect(response).toMatchObject({
          success: true,
          data: {
            preferences: null,
            message: "No preferences found for user",
          },
        });
      });

      it("should handle GET workflow database failures", async () => {
        mockUserPreferencesAccess.getLatestWithMetadata.mockRejectedValue(
          new Error("Database connection failed")
        );

        const event = createMockEvent("GET");
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(500);
        const response = JSON.parse(result.body);
        expect(response.error).toMatchObject({
          code: "PREFERENCES_RETRIEVAL_ERROR",
          message: "Failed to retrieve preferences. Please try again later.",
        });
      });
    });

    describe("EventBridge Integration Removal Verification", () => {
      it("should verify EventBridge is completely removed from POST workflow", async () => {
        // Requirements: 4.1, 4.2
        const event = createMockEvent("POST", JSON.stringify(validPreferences));
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(200);

        // Verify response doesn't mention workflow triggering
        const response = JSON.parse(result.body);
        expect(response.data.message).toBe("Preferences saved successfully");
        expect(response.data.message).not.toContain("workflow");
        expect(response.data.message).not.toContain("generation");
        expect(response.data.message).not.toContain("triggered");
      });
    });

    describe("Complete User Journey End-to-End", () => {
      it("should handle complete user journey from no preferences to having preferences", async () => {
        // Step 1: GET when user has no preferences
        mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValueOnce({
          preferences: null,
        });

        const initialGetEvent = createMockEvent("GET");
        const initialGetResult = await preferencesHandler(
          initialGetEvent,
          mockContext
        );

        expect(initialGetResult.statusCode).toBe(200);
        const initialGetResponse = JSON.parse(initialGetResult.body);
        expect(initialGetResponse.data.preferences).toBeNull();

        // Step 2: POST to create preferences
        const postEvent = createMockEvent(
          "POST",
          JSON.stringify(validPreferences)
        );
        const postResult = await preferencesHandler(postEvent, mockContext);

        expect(postResult.statusCode).toBe(200);
        const postResponse = JSON.parse(postResult.body);
        expect(postResponse.data.preferences).toEqual(validPreferences);

        // Verify preferences were stored
        expect(mockUserPreferencesAccess.create).toHaveBeenCalledWith(
          mockUserId,
          {
            preferences: validPreferences,
            insights: mockInsights,
          }
        );

        // Step 3: GET after creating preferences
        mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValueOnce({
          preferences: validPreferences,
          insights: mockInsights,
          lastUpdated: "2023-01-01T00:00:00.000Z",
        });

        const finalGetEvent = createMockEvent("GET");
        const finalGetResult = await preferencesHandler(
          finalGetEvent,
          mockContext
        );

        expect(finalGetResult.statusCode).toBe(200);
        const finalGetResponse = JSON.parse(finalGetResult.body);
        expect(finalGetResponse.data.preferences).toEqual(validPreferences);
        expect(finalGetResponse.data.insights).toEqual(mockInsights);
      });
    });
  });

  describe("Authentication and Authorization End-to-End", () => {
    it("should handle authentication failures consistently across endpoints", async () => {
      const unauthenticatedEvent = createMockEvent("GET", null, "");
      unauthenticatedEvent.requestContext.authorizer = undefined;

      const getResult = await preferencesHandler(
        unauthenticatedEvent,
        mockContext
      );
      expect(getResult.statusCode).toBe(401);

      const postEvent = createMockEvent(
        "POST",
        JSON.stringify(validPreferences),
        ""
      );
      postEvent.requestContext.authorizer = undefined;

      const postResult = await preferencesHandler(postEvent, mockContext);
      expect(postResult.statusCode).toBe(401);

      // Verify consistent error format
      const getError = JSON.parse(getResult.body);
      const postError = JSON.parse(postResult.body);

      expect(getError.error.code).toBe("UNAUTHORIZED");
      expect(postError.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("Error Handling Consistency", () => {
    it("should maintain consistent error response format across all scenarios", async () => {
      // Test GET database error
      mockUserPreferencesAccess.getLatestWithMetadata.mockRejectedValue(
        new Error("Database error")
      );
      const getEvent = createMockEvent("GET");
      const getResult = await preferencesHandler(getEvent, mockContext);

      const getResponse = JSON.parse(getResult.body);
      expect(getResponse.error).toMatchObject({
        code: "PREFERENCES_RETRIEVAL_ERROR",
        message: expect.any(String),
        requestId: "e2e-test-request-id",
        timestamp: expect.any(String),
      });

      // Reset for next test
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: validPreferences,
        insights: mockInsights,
        lastUpdated: "2023-01-01T00:00:00.000Z",
      });

      // Test POST validation error
      mockValidatePreferences.mockReturnValueOnce({
        isValid: false,
        errors: ["Validation failed"],
      });
      const postEvent = createMockEvent("POST", JSON.stringify({}));
      const postResult = await preferencesHandler(postEvent, mockContext);

      const postResponse = JSON.parse(postResult.body);
      expect(postResponse.error).toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.any(String),
        requestId: "e2e-test-request-id",
        timestamp: expect.any(String),
      });

      // Test unsupported method error
      const methodEvent = createMockEvent("DELETE");
      const methodResult = await preferencesHandler(methodEvent, mockContext);

      const methodResponse = JSON.parse(methodResult.body);
      expect(methodResponse.error).toMatchObject({
        code: "METHOD_NOT_ALLOWED",
        message: expect.any(String),
        requestId: "e2e-test-request-id",
        timestamp: expect.any(String),
      });
    });
  });
});
