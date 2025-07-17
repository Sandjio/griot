import { handler as preferencesHandler } from "../preferences-processing/index";
import { handler as statusHandler } from "../status-check/index";
import {
  GenerationRequestAccess,
  UserPreferencesAccess,
  StoryAccess,
  EpisodeAccess,
} from "../../database/access-patterns";
import { QlooApiClient } from "../preferences-processing/qloo-client";
import { EventPublishingHelpers } from "../../utils/event-publisher";

// Mock all external dependencies
jest.mock("../../database/access-patterns");
jest.mock("../preferences-processing/qloo-client");
jest.mock("../../utils/event-publisher");

const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockQlooApiClient = QlooApiClient as jest.MockedClass<
  typeof QlooApiClient
>;
const mockEventPublishingHelpers = EventPublishingHelpers as jest.Mocked<
  typeof EventPublishingHelpers
>;

describe("API Endpoints Comprehensive Tests", () => {
  const mockUserId = "test-user-123";
  const mockRequestId = "test-request-456";
  const mockStoryId = "test-story-789";
  const mockEpisodeId = "test-episode-101";

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  describe("POST /preferences - Request Validation", () => {
    const createPreferencesEvent = (body: any, userId?: string) => ({
      httpMethod: "POST",
      path: "/preferences",
      pathParameters: null,
      queryStringParameters: null,
      headers: {
        "Content-Type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
      requestContext: {
        requestId: "api-request-123",
        authorizer: userId
          ? {
              claims: {
                sub: userId,
                email: "test@example.com",
              },
            }
          : undefined,
      },
    });

    it("should return 401 for unauthenticated requests", async () => {
      const validPreferences = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const event = createPreferencesEvent(validPreferences);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(401);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("UNAUTHORIZED");
      expect(response.error.message).toBe("User not authenticated");
    });

    it("should return 400 for missing request body", async () => {
      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
        },
        body: null,
        requestContext: {
          requestId: "api-request-123",
          authorizer: {
            claims: {
              sub: mockUserId,
              email: "test@example.com",
            },
          },
        },
      };

      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("INVALID_REQUEST");
      expect(response.error.message).toBe("Request body is required");
    });

    it("should return 400 for invalid JSON in request body", async () => {
      const event = createPreferencesEvent("invalid json", mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("INVALID_JSON");
      expect(response.error.message).toBe("Invalid JSON in request body");
    });

    it("should validate all required fields are present", async () => {
      const incompletePreferences = {
        genres: ["Action"],
        // Missing themes, artStyle, targetAudience, contentRating
      };

      const event = createPreferencesEvent(incompletePreferences, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toContain("Themes are required");
      expect(response.error.message).toContain("Art style is required");
      expect(response.error.message).toContain("Target audience is required");
      expect(response.error.message).toContain("Content rating is required");
    });

    it("should validate genre array constraints", async () => {
      const invalidGenres = {
        genres: [], // Empty array
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const event = createPreferencesEvent(invalidGenres, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toContain(
        "At least one genre must be selected"
      );
    });

    it("should validate maximum genre limit", async () => {
      const tooManyGenres = {
        genres: ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror"], // 6 genres, max is 5
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const event = createPreferencesEvent(tooManyGenres, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toContain(
        "Maximum 5 genres can be selected"
      );
    });

    it("should validate invalid genre values", async () => {
      const invalidGenreValues = {
        genres: ["InvalidGenre", "AnotherInvalidGenre"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const event = createPreferencesEvent(invalidGenreValues, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toContain("Invalid genres");
    });

    it("should validate art style enum values", async () => {
      const invalidArtStyle = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "InvalidArtStyle",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const event = createPreferencesEvent(invalidArtStyle, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toContain("Invalid art style");
    });

    it("should validate target audience enum values", async () => {
      const invalidTargetAudience = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "InvalidAudience",
        contentRating: "PG-13",
      };

      const event = createPreferencesEvent(invalidTargetAudience, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toContain("Invalid target audience");
    });

    it("should validate content rating enum values", async () => {
      const invalidContentRating = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "InvalidRating",
      };

      const event = createPreferencesEvent(invalidContentRating, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toContain("Invalid content rating");
    });
  });

  describe("GET /status/{requestId} - Request Validation", () => {
    const createStatusEvent = (requestId?: string, userId?: string) => ({
      httpMethod: "GET",
      path: `/status/${requestId || mockRequestId}`,
      pathParameters: requestId ? { requestId } : null,
      queryStringParameters: null,
      headers: {},
      body: null,
      requestContext: {
        requestId: "api-request-456",
        authorizer: userId
          ? {
              claims: {
                sub: userId,
                email: "test@example.com",
              },
            }
          : undefined,
      },
    });

    it("should return 401 for unauthenticated requests", async () => {
      const event = createStatusEvent(mockRequestId);
      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(401);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("UNAUTHORIZED");
      expect(response.error.message).toBe("User not authenticated");
    });

    it("should return 400 for missing requestId path parameter", async () => {
      const event = createStatusEvent(undefined, mockUserId);
      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("INVALID_REQUEST");
      expect(response.error.message).toBe(
        "Request ID is required in path parameters"
      );
    });

    it("should return 404 for non-existent request", async () => {
      const event = createStatusEvent("non-existent-request", mockUserId);
      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(null);

      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(404);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("REQUEST_NOT_FOUND");
      expect(response.error.message).toBe("Generation request not found");
    });

    it("should return 403 for accessing another user's request", async () => {
      const event = createStatusEvent(mockRequestId, mockUserId);
      const otherUserRequest = {
        PK: `USER#other-user`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: "other-user",
        type: "STORY" as const,
        status: "PROCESSING" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(
        otherUserRequest
      );

      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(403);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("FORBIDDEN");
      expect(response.error.message).toBe(
        "Access denied to this generation request"
      );
    });
  });

  describe("HTTP Response Headers", () => {
    it("should include proper CORS headers in preferences response", async () => {
      const validPreferences = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const mockInsights = {
        recommendations: [],
        trends: [],
      };

      mockGenerationRequestAccess.create.mockResolvedValue();
      mockQlooApiClient.prototype.fetchInsights.mockResolvedValue(mockInsights);
      mockUserPreferencesAccess.create.mockResolvedValue();
      mockGenerationRequestAccess.updateStatus.mockResolvedValue();
      mockEventPublishingHelpers.publishStoryGeneration.mockResolvedValue();

      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPreferences),
        requestContext: {
          requestId: "api-request-123",
          authorizer: {
            claims: { sub: mockUserId, email: "test@example.com" },
          },
        },
      };

      const result = await preferencesHandler(event as any);

      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      });
    });

    it("should include proper CORS headers in status response", async () => {
      const mockRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY" as const,
        status: "COMPLETED" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const event = {
        httpMethod: "GET",
        path: `/status/${mockRequestId}`,
        pathParameters: { requestId: mockRequestId },
        queryStringParameters: null,
        headers: {},
        body: null,
        requestContext: {
          requestId: "api-request-456",
          authorizer: {
            claims: { sub: mockUserId, email: "test@example.com" },
          },
        },
      };

      const result = await statusHandler(event as any);

      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      });
    });
  });

  describe("Response Format Validation", () => {
    it("should return properly formatted success response for preferences", async () => {
      const validPreferences = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const mockInsights = {
        recommendations: [],
        trends: [],
      };

      mockGenerationRequestAccess.create.mockResolvedValue();
      mockQlooApiClient.prototype.fetchInsights.mockResolvedValue(mockInsights);
      mockUserPreferencesAccess.create.mockResolvedValue();
      mockGenerationRequestAccess.updateStatus.mockResolvedValue();
      mockEventPublishingHelpers.publishStoryGeneration.mockResolvedValue();

      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPreferences),
        requestContext: {
          requestId: "api-request-123",
          authorizer: {
            claims: { sub: mockUserId, email: "test@example.com" },
          },
        },
      };

      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toHaveProperty("success", true);
      expect(response).toHaveProperty("data");
      expect(response).toHaveProperty("timestamp");
      expect(response.data).toHaveProperty("requestId");
      expect(response.data).toHaveProperty("status", "PROCESSING");
      expect(response.data).toHaveProperty("message");
      expect(response.data).toHaveProperty("estimatedCompletionTime");
    });

    it("should return properly formatted error response", async () => {
      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: { "Content-Type": "application/json" },
        body: null,
        requestContext: {
          requestId: "api-request-123",
          authorizer: {
            claims: { sub: mockUserId, email: "test@example.com" },
          },
        },
      };

      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response).toHaveProperty("error");
      expect(response.error).toHaveProperty("code");
      expect(response.error).toHaveProperty("message");
      expect(response.error).toHaveProperty("timestamp");
    });

    it("should return properly formatted status response", async () => {
      const mockRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY" as const,
        status: "PROCESSING" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
        relatedEntityId: mockStoryId,
      };

      const mockStory = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Test Story",
        s3Key: "stories/test-story.md",
        status: "PROCESSING" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([]);

      const event = {
        httpMethod: "GET",
        path: `/status/${mockRequestId}`,
        pathParameters: { requestId: mockRequestId },
        queryStringParameters: null,
        headers: {},
        body: null,
        requestContext: {
          requestId: "api-request-456",
          authorizer: {
            claims: { sub: mockUserId, email: "test@example.com" },
          },
        },
      };

      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toHaveProperty("requestId");
      expect(response).toHaveProperty("status");
      expect(response).toHaveProperty("type");
      expect(response).toHaveProperty("timestamp");
      expect(response).toHaveProperty("progress");
      expect(response).toHaveProperty("result");
      expect(response.progress).toHaveProperty("currentStep");
      expect(response.progress).toHaveProperty("totalSteps");
      expect(response.progress).toHaveProperty("completedSteps");
    });
  });

  describe("Error Handling Edge Cases", () => {
    it("should handle unexpected errors gracefully in preferences endpoint", async () => {
      const validPreferences = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      // Mock an unexpected error
      mockGenerationRequestAccess.create.mockRejectedValue(
        new Error("Unexpected database error")
      );

      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPreferences),
        requestContext: {
          requestId: "api-request-123",
          authorizer: {
            claims: { sub: mockUserId, email: "test@example.com" },
          },
        },
      };

      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.message).toBe(
        "An unexpected error occurred. Please try again later."
      );
    });

    it("should handle unexpected errors gracefully in status endpoint", async () => {
      // Mock an unexpected error
      mockGenerationRequestAccess.getByRequestId.mockRejectedValue(
        new Error("Unexpected database error")
      );

      const event = {
        httpMethod: "GET",
        path: `/status/${mockRequestId}`,
        pathParameters: { requestId: mockRequestId },
        queryStringParameters: null,
        headers: {},
        body: null,
        requestContext: {
          requestId: "api-request-456",
          authorizer: {
            claims: { sub: mockUserId, email: "test@example.com" },
          },
        },
      };

      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.message).toBe(
        "An unexpected error occurred while checking status"
      );
    });
  });
});
