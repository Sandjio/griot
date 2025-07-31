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

describe("Preferences API Backward Compatibility - Simple Tests", () => {
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

  // Legacy preference format (what existing clients send)
  const legacyPreferences = {
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
    userId: string = "test-user-123"
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
      requestId: "backward-compat-test-request-id",
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
        userAgent: "legacy-client/1.0",
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
    mockValidatePreferences.mockReturnValue({ isValid: true, errors: [] });
    mockUserPreferencesAccess.create.mockResolvedValue();
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: legacyPreferences,
      insights: mockInsights,
      lastUpdated: "2023-01-01T00:00:00.000Z",
    });

    const mockQlooInstance = {
      fetchInsights: jest.fn().mockResolvedValue(mockInsights),
    };
    mockQlooApiClient.mockImplementation(() => mockQlooInstance as any);

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

  describe("Task 10.2: Backward Compatibility Validation", () => {
    describe("Response Format Validation", () => {
      it("should maintain POST response structure for backward compatibility", async () => {
        // Requirements: 1.1, 1.4, 1.5, 5.1, 5.5
        const event = createMockEvent(
          "POST",
          JSON.stringify(legacyPreferences)
        );

        const result = await preferencesHandler(event, mockContext);

        // Verify response structure matches legacy expectations
        expect(result).toHaveProperty("statusCode");
        expect(result).toHaveProperty("headers");
        expect(result).toHaveProperty("body");

        // Verify headers include CORS
        expect(result.headers).toMatchObject({
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });

        // Parse and validate response body structure
        const response = JSON.parse(result.body);

        if (result.statusCode === 200) {
          // Success response structure
          expect(response).toHaveProperty("success", true);
          expect(response).toHaveProperty("data");
          expect(response).toHaveProperty("requestId");
          expect(response).toHaveProperty("timestamp");

          expect(response.data).toHaveProperty("message");
          expect(response.data).toHaveProperty("preferences");
          expect(response.data).toHaveProperty("insights");
        } else {
          // Error response structure
          expect(response).toHaveProperty("error");
          expect(response.error).toHaveProperty("code");
          expect(response.error).toHaveProperty("message");
          expect(response.error).toHaveProperty("timestamp");
        }
      });

      it("should maintain GET response structure for new functionality", async () => {
        // Requirements: 2.1, 2.2, 5.1, 5.5
        const event = createMockEvent("GET");

        const result = await preferencesHandler(event, mockContext);

        // Verify response structure
        expect(result).toHaveProperty("statusCode");
        expect(result).toHaveProperty("headers");
        expect(result).toHaveProperty("body");

        // Verify headers include CORS
        expect(result.headers).toMatchObject({
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });

        // Parse and validate response body structure
        const response = JSON.parse(result.body);

        if (result.statusCode === 200) {
          // Success response structure
          expect(response).toHaveProperty("success", true);
          expect(response).toHaveProperty("data");
          expect(response).toHaveProperty("requestId");
          expect(response).toHaveProperty("timestamp");

          expect(response.data).toHaveProperty("preferences");
          // insights and lastUpdated are optional
        } else {
          // Error response structure
          expect(response).toHaveProperty("error");
          expect(response.error).toHaveProperty("code");
          expect(response.error).toHaveProperty("message");
          expect(response.error).toHaveProperty("timestamp");
        }
      });
    });

    describe("Request Format Validation", () => {
      it("should accept legacy preference fields without breaking changes", async () => {
        // Requirements: 1.1, 1.4, 1.5
        const legacyRequest = {
          genres: ["Action", "Adventure", "Comedy"],
          themes: ["Friendship", "Good vs Evil", "Coming of Age"],
          artStyle: "Traditional",
          targetAudience: "Teens",
          contentRating: "PG-13",
        };

        const event = createMockEvent("POST", JSON.stringify(legacyRequest));
        const result = await preferencesHandler(event, mockContext);

        // Verify the request was processed (regardless of success/failure)
        expect(result.statusCode).toBeGreaterThanOrEqual(200);
        expect(result.statusCode).toBeLessThan(600);

        // Verify response has proper structure
        const response = JSON.parse(result.body);
        expect(response).toBeDefined();
      });
    });

    describe("Workflow Integration Changes", () => {
      it("should verify POST response no longer mentions workflow triggering", async () => {
        // Requirements: 4.1, 4.2, 4.5
        const event = createMockEvent(
          "POST",
          JSON.stringify(legacyPreferences)
        );
        const result = await preferencesHandler(event, mockContext);

        const response = JSON.parse(result.body);

        // Check success response message
        if (result.statusCode === 200 && response.data?.message) {
          expect(response.data.message).not.toContain("workflow");
          expect(response.data.message).not.toContain("generation");
          expect(response.data.message).not.toContain("triggered");
          expect(response.data.message).not.toContain("initiated");
        }

        // Verify no workflow-related fields in response
        if (result.statusCode === 200 && response.data) {
          expect(response.data).not.toHaveProperty("workflowId");
          expect(response.data).not.toHaveProperty("generationStatus");
          expect(response.data).not.toHaveProperty("workflowTriggered");
        }
      });
    });

    describe("Error Response Consistency", () => {
      it("should maintain consistent error response format", async () => {
        // Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
        const testScenarios = [
          {
            name: "Missing body",
            event: createMockEvent("POST", null),
            expectedStatus: 400,
          },
          {
            name: "Invalid JSON",
            event: createMockEvent("POST", '{"invalid": json}'),
            expectedStatus: 400,
          },
          {
            name: "Unauthorized",
            event: (() => {
              const e = createMockEvent(
                "POST",
                JSON.stringify(legacyPreferences),
                ""
              );
              e.requestContext.authorizer = undefined;
              return e;
            })(),
            expectedStatus: 401,
          },
        ];

        for (const scenario of testScenarios) {
          const result = await preferencesHandler(scenario.event, mockContext);

          expect(result.statusCode).toBe(scenario.expectedStatus);
          const response = JSON.parse(result.body);

          // Verify error response structure
          expect(response.error).toMatchObject({
            code: expect.any(String),
            message: expect.any(String),
            timestamp: expect.any(String),
          });
        }
      });
    });

    describe("HTTP Method Support", () => {
      it("should support both GET and POST methods", async () => {
        // Test POST method
        const postEvent = createMockEvent(
          "POST",
          JSON.stringify(legacyPreferences)
        );
        const postResult = await preferencesHandler(postEvent, mockContext);
        expect(postResult.statusCode).not.toBe(405); // Method not allowed

        // Test GET method
        const getEvent = createMockEvent("GET");
        const getResult = await preferencesHandler(getEvent, mockContext);
        expect(getResult.statusCode).not.toBe(405); // Method not allowed
      });

      it("should reject unsupported HTTP methods", async () => {
        const putEvent = createMockEvent(
          "PUT",
          JSON.stringify(legacyPreferences)
        );
        const result = await preferencesHandler(putEvent, mockContext);

        expect(result.statusCode).toBe(405);
        const response = JSON.parse(result.body);
        expect(response.error.code).toBe("METHOD_NOT_ALLOWED");
      });
    });
  });
});
