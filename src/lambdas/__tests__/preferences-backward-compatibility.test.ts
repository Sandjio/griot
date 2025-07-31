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

describe("Preferences API Backward Compatibility Tests", () => {
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

  let mockQlooInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset validation mock to default
    mockValidatePreferences.mockReturnValue({ isValid: true, errors: [] });

    // Setup default mocks
    mockUserPreferencesAccess.create.mockResolvedValue();
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: legacyPreferences,
      insights: mockInsights,
      lastUpdated: "2023-01-01T00:00:00.000Z",
    });

    // Setup Qloo API client mock
    mockQlooInstance = {
      fetchInsights: jest.fn().mockResolvedValue(mockInsights),
    };
    mockQlooApiClient.mockImplementation(() => mockQlooInstance);

    // Debug: Verify mock is set up correctly
    console.log("Mock Qloo instance:", mockQlooInstance);
    console.log("Mock Qloo client:", mockQlooApiClient);

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
    describe("Existing POST Endpoint Functionality Preserved", () => {
      it("should accept legacy preference format without breaking changes", async () => {
        // Requirements: 1.1, 1.4, 1.5
        const event = createMockEvent(
          "POST",
          JSON.stringify(legacyPreferences)
        );

        const result = await preferencesHandler(event, mockContext);

        // Debug: Log the actual response if it's not 200
        if (result.statusCode !== 200) {
          console.log("Actual response:", result);
        }

        // Verify the endpoint still works with legacy format
        expect(result.statusCode).toBe(200);

        const response = JSON.parse(result.body);
        expect(response).toMatchObject({
          success: true,
          data: {
            message: "Preferences saved successfully",
            preferences: legacyPreferences,
            insights: mockInsights,
          },
          requestId: "backward-compat-test-request-id",
          timestamp: expect.any(String),
        });

        // Verify legacy data is processed correctly
        expect(mockQlooInstance.fetchInsights).toHaveBeenCalledWith(
          legacyPreferences
        );
        expect(mockUserPreferencesAccess.create).toHaveBeenCalledWith(
          mockUserId,
          {
            preferences: legacyPreferences,
            insights: mockInsights,
          }
        );
      });

      it("should maintain existing validation rules for legacy clients", async () => {
        // Test with invalid legacy format
        const invalidLegacyPreferences = {
          genres: [], // Invalid: empty array
          themes: ["ValidTheme"],
          artStyle: "Traditional",
          targetAudience: "Teens",
          contentRating: "PG-13",
        };

        mockValidatePreferences.mockReturnValueOnce({
          isValid: false,
          errors: ["At least one genre must be selected"],
        });

        const event = createMockEvent(
          "POST",
          JSON.stringify(invalidLegacyPreferences)
        );
        const result = await preferencesHandler(event, mockContext);

        // Verify existing validation still works
        expect(result.statusCode).toBe(400);
        const response = JSON.parse(result.body);
        expect(response.error).toMatchObject({
          code: "VALIDATION_ERROR",
          message: expect.stringContaining(
            "At least one genre must be selected"
          ),
        });
      });

      it("should preserve existing error response format", async () => {
        // Test various error scenarios to ensure format consistency
        const scenarios = [
          {
            name: "Missing body",
            event: createMockEvent("POST", null),
            expectedCode: "MISSING_BODY",
            expectedStatus: 400,
          },
          {
            name: "Invalid JSON",
            event: createMockEvent("POST", '{"invalid": json}'),
            expectedCode: "INVALID_JSON",
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
            expectedCode: "UNAUTHORIZED",
            expectedStatus: 401,
          },
        ];

        for (const scenario of scenarios) {
          const result = await preferencesHandler(scenario.event, mockContext);

          expect(result.statusCode).toBe(scenario.expectedStatus);
          const response = JSON.parse(result.body);
          expect(response.error).toMatchObject({
            code: scenario.expectedCode,
            message: expect.any(String),
            requestId: "backward-compat-test-request-id",
            timestamp: expect.any(String),
          });
        }
      });
    });

    describe("No Breaking Changes to Request/Response Formats", () => {
      it("should maintain exact POST request format compatibility", async () => {
        // Test that all existing request fields are still accepted
        const fullLegacyRequest = {
          genres: ["Action", "Adventure", "Comedy"],
          themes: ["Friendship", "Good vs Evil", "Coming of Age"],
          artStyle: "Traditional",
          targetAudience: "Teens",
          contentRating: "PG-13",
        };

        const event = createMockEvent(
          "POST",
          JSON.stringify(fullLegacyRequest)
        );
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);

        // Verify all fields are preserved in response
        expect(response.data.preferences).toEqual(fullLegacyRequest);
        expect(response.data.preferences.genres).toEqual(
          fullLegacyRequest.genres
        );
        expect(response.data.preferences.themes).toEqual(
          fullLegacyRequest.themes
        );
        expect(response.data.preferences.artStyle).toBe(
          fullLegacyRequest.artStyle
        );
        expect(response.data.preferences.targetAudience).toBe(
          fullLegacyRequest.targetAudience
        );
        expect(response.data.preferences.contentRating).toBe(
          fullLegacyRequest.contentRating
        );
      });

      it("should maintain exact POST response format compatibility", async () => {
        const event = createMockEvent(
          "POST",
          JSON.stringify(legacyPreferences)
        );
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);

        // Verify response structure matches legacy expectations
        expect(response).toHaveProperty("success", true);
        expect(response).toHaveProperty("data");
        expect(response).toHaveProperty("requestId");
        expect(response).toHaveProperty("timestamp");

        expect(response.data).toHaveProperty("message");
        expect(response.data).toHaveProperty("preferences");
        expect(response.data).toHaveProperty("insights");

        expect(response.data.insights).toHaveProperty("recommendations");
        expect(response.data.insights).toHaveProperty("trends");

        // Verify no new required fields were added
        const expectedKeys = ["success", "data", "requestId", "timestamp"];
        expect(Object.keys(response).sort()).toEqual(expectedKeys.sort());

        const expectedDataKeys = ["message", "preferences", "insights"];
        expect(Object.keys(response.data).sort()).toEqual(
          expectedDataKeys.sort()
        );
      });

      it("should maintain HTTP headers compatibility", async () => {
        const event = createMockEvent(
          "POST",
          JSON.stringify(legacyPreferences)
        );
        const result = await preferencesHandler(event, mockContext);

        // Verify all expected headers are present
        expect(result.headers).toMatchObject({
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": expect.any(String),
          "Access-Control-Allow-Methods": expect.any(String),
        });

        // Verify security headers are maintained
        expect(result.headers).toMatchObject({
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "X-XSS-Protection": "1; mode=block",
          "Strict-Transport-Security": expect.any(String),
          "Referrer-Policy": "strict-origin-when-cross-origin",
        });
      });
    });

    describe("Frontend Integration Compatibility", () => {
      it("should work with existing frontend POST request patterns", async () => {
        // Simulate how frontend currently sends requests
        const frontendRequest = {
          genres: ["Action", "Adventure"],
          themes: ["Friendship", "Good vs Evil"],
          artStyle: "Traditional",
          targetAudience: "Teens",
          contentRating: "PG-13",
        };

        const event = createMockEvent("POST", JSON.stringify(frontendRequest));
        // Simulate frontend headers
        event.headers = {
          ...event.headers,
          "User-Agent": "Mozilla/5.0 (compatible; Frontend/1.0)",
          Accept: "application/json",
          "Content-Type": "application/json",
        };

        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);

        // Verify frontend can parse the response
        expect(response.success).toBe(true);
        expect(response.data.message).toBe("Preferences saved successfully");
        expect(response.data.preferences).toEqual(frontendRequest);
      });

      it("should support new GET endpoint for frontend preference retrieval", async () => {
        // Requirements: 2.1, 5.1, 5.5
        const event = createMockEvent("GET");
        event.headers = {
          ...event.headers,
          "User-Agent": "Mozilla/5.0 (compatible; Frontend/1.0)",
          Accept: "application/json",
        };

        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);

        // Verify frontend can use the new GET endpoint
        expect(response.success).toBe(true);
        expect(response.data.preferences).toEqual(legacyPreferences);
        expect(response.data.insights).toEqual(mockInsights);
        expect(response.data.lastUpdated).toBe("2023-01-01T00:00:00.000Z");
      });

      it("should handle frontend error scenarios gracefully", async () => {
        // Test network timeout simulation
        mockQlooInstance.fetchInsights.mockRejectedValue(
          new Error("Network timeout")
        );

        const event = createMockEvent(
          "POST",
          JSON.stringify(legacyPreferences)
        );
        event.headers = {
          ...event.headers,
          "User-Agent": "Mozilla/5.0 (compatible; Frontend/1.0)",
        };

        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(500);
        const response = JSON.parse(result.body);

        // Verify frontend gets expected error format
        expect(response.error).toMatchObject({
          code: "QLOO_API_ERROR",
          message:
            "Failed to process user preferences. Please try again later.",
          requestId: "backward-compat-test-request-id",
          timestamp: expect.any(String),
        });
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

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);

        // Verify response message doesn't mention workflow triggering
        expect(response.data.message).toBe("Preferences saved successfully");
        expect(response.data.message).not.toContain("workflow");
        expect(response.data.message).not.toContain("generation");
        expect(response.data.message).not.toContain("triggered");
        expect(response.data.message).not.toContain("initiated");

        // Verify no workflow-related fields in response
        expect(response.data).not.toHaveProperty("workflowId");
        expect(response.data).not.toHaveProperty("generationStatus");
        expect(response.data).not.toHaveProperty("workflowTriggered");
      });

      it("should maintain all other POST functionality except workflow triggering", async () => {
        const event = createMockEvent(
          "POST",
          JSON.stringify(legacyPreferences)
        );
        const result = await preferencesHandler(event, mockContext);

        expect(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);

        // Verify all core functionality is preserved
        expect(response.data.preferences).toEqual(legacyPreferences);
        expect(response.data.insights).toEqual(mockInsights);
        expect(response.data.message).toBe("Preferences saved successfully");

        // Verify database operations still work
        expect(mockUserPreferencesAccess.create).toHaveBeenCalledWith(
          mockUserId,
          {
            preferences: legacyPreferences,
            insights: mockInsights,
          }
        );

        // Verify Qloo API integration still works
        expect(mockQlooInstance.fetchInsights).toHaveBeenCalledWith(
          legacyPreferences
        );
      });
    });

    describe("API Contract Stability", () => {
      it("should maintain stable API contract for existing clients", async () => {
        // Test multiple request variations that existing clients might send
        const requestVariations = [
          {
            name: "Minimal request",
            data: {
              genres: ["Action"],
              themes: ["Friendship"],
              artStyle: "Traditional",
              targetAudience: "Teens",
              contentRating: "PG-13",
            },
          },
          {
            name: "Full request",
            data: {
              genres: ["Action", "Adventure", "Comedy"],
              themes: ["Friendship", "Good vs Evil", "Coming of Age"],
              artStyle: "Modern",
              targetAudience: "Young Adults",
              contentRating: "R",
            },
          },
        ];

        for (const variation of requestVariations) {
          const event = createMockEvent("POST", JSON.stringify(variation.data));
          const result = await preferencesHandler(event, mockContext);

          expect(result.statusCode).toBe(200);
          const response = JSON.parse(result.body);

          // Verify consistent response structure
          expect(response).toMatchObject({
            success: true,
            data: {
              message: "Preferences saved successfully",
              preferences: variation.data,
              insights: mockInsights,
            },
            requestId: expect.any(String),
            timestamp: expect.any(String),
          });
        }
      });
    });
  });
});
