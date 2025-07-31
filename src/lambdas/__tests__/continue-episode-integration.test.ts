import { handler as continueEpisodeHandler } from "../continue-episode/index";
import {
  StoryAccess,
  EpisodeAccess,
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../../database/access-patterns";
import { EventPublisher } from "../../utils/event-publisher";

// Mock all external dependencies
jest.mock("../../database/access-patterns");
jest.mock("../../utils/event-publisher");
jest.mock("../../utils/input-validation", () => ({
  validateApiGatewayEvent: jest.fn(() => ({ isValid: true, errors: [] })),
  RateLimiter: {
    isAllowed: jest.fn(() => true), // Default to allowing requests
  },
  SECURITY_HEADERS: {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Content-Security-Policy": "default-src 'self'",
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

const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
const mockEventPublisher = EventPublisher as jest.MockedClass<
  typeof EventPublisher
>;

describe("Continue Episode API Integration Tests", () => {
  const mockUserId = "test-user-123";
  const mockStoryId = "test-story-789";
  const mockEpisodeId = "test-episode-456";

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();

    // Reset rate limiter to allow requests by default
    const { RateLimiter } = require("../../utils/input-validation");
    RateLimiter.isAllowed.mockReturnValue(true);
  });

  describe("POST /stories/{storyId}/episodes Endpoint Integration", () => {
    it("should handle complete continue episode workflow successfully", async () => {
      const mockStory = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Adventure Story",
        s3Key: "stories/user-123/story-789/story.md",
        status: "COMPLETED" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockExistingEpisodes = [
        {
          PK: `STORY#${mockStoryId}`,
          SK: "EPISODE#001",
          GSI1PK: "EPISODE#episode-001",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#COMPLETED",
          GSI2SK: "2024-01-01T00:30:00.000Z",
          episodeId: "episode-001",
          episodeNumber: 1,
          storyId: mockStoryId,
          s3Key: "episodes/user-123/story-789/001/episode.md",
          pdfS3Key: "episodes/user-123/story-789/001/episode.pdf",
          status: "COMPLETED" as const,
          createdAt: "2024-01-01T00:30:00.000Z",
        },
      ];

      const mockPreferences = {
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
        trends: [{ topic: "adventure", popularity: 85 }],
      };

      // Mock successful flow
      mockStoryAccess.get.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue(
        mockExistingEpisodes
      );
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: mockPreferences,
        insights: mockInsights,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });
      mockGenerationRequestAccess.create.mockResolvedValue();
      mockEventPublisher.prototype.publishEvent.mockResolvedValue();

      const event = {
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      // Verify response structure
      expect(result.statusCode).toBe(202);
      expect(result.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/json",
          "X-Request-ID": "api-request-123",
        })
      );

      const response = JSON.parse(result.body);
      expect(response).toMatchObject({
        episodeId: expect.any(String),
        episodeNumber: 2, // Next episode after existing episode 1
        status: "GENERATING",
        estimatedCompletionTime: expect.any(String),
        message: "Episode generation started successfully",
        timestamp: expect.any(String),
      });

      // Verify all integration steps were called correctly
      expect(mockStoryAccess.get).toHaveBeenCalledWith(mockUserId, mockStoryId);
      expect(mockEpisodeAccess.getStoryEpisodes).toHaveBeenCalledWith(
        mockStoryId
      );
      expect(
        mockUserPreferencesAccess.getLatestWithMetadata
      ).toHaveBeenCalledWith(mockUserId);
      expect(mockGenerationRequestAccess.create).toHaveBeenCalledWith({
        requestId: expect.any(String),
        userId: mockUserId,
        type: "EPISODE",
        status: "PROCESSING",
        createdAt: expect.any(String),
        relatedEntityId: expect.any(String),
      });
      expect(mockEventPublisher.prototype.publishEvent).toHaveBeenCalledWith({
        source: "manga.story",
        "detail-type": "Continue Episode Requested",
        detail: {
          userId: mockUserId,
          storyId: mockStoryId,
          nextEpisodeNumber: 2,
          originalPreferences: mockPreferences,
          storyS3Key: mockStory.s3Key,
          timestamp: expect.any(String),
        },
      });
    });

    it("should handle story not found error with proper HTTP status code", async () => {
      mockStoryAccess.get.mockResolvedValue(null);

      const event = {
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.statusCode).toBe(404);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "STORY_NOT_FOUND",
        message: "Story not found or you don't have access to it",
        requestId: "api-request-123",
        timestamp: expect.any(String),
      });

      // Verify no further operations were attempted
      expect(mockEpisodeAccess.getStoryEpisodes).not.toHaveBeenCalled();
      expect(mockGenerationRequestAccess.create).not.toHaveBeenCalled();
    });

    it("should handle story not completed error", async () => {
      const mockProcessingStory = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Adventure Story",
        s3Key: "stories/user-123/story-789/story.md",
        status: "PROCESSING" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockStoryAccess.get.mockResolvedValue(mockProcessingStory);

      const event = {
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "STORY_NOT_COMPLETED",
        message:
          "Cannot continue episodes for story with status: PROCESSING. Story must be completed first.",
        requestId: "api-request-123",
        timestamp: expect.any(String),
      });
    });

    it("should handle episode already exists conflict", async () => {
      const mockStory = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Adventure Story",
        s3Key: "stories/user-123/story-789/story.md",
        status: "COMPLETED" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockExistingEpisodes = [
        {
          PK: `STORY#${mockStoryId}`,
          SK: "EPISODE#001",
          GSI1PK: "EPISODE#episode-001",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#COMPLETED",
          GSI2SK: "2024-01-01T00:30:00.000Z",
          episodeId: "episode-001",
          episodeNumber: 1,
          storyId: mockStoryId,
          s3Key: "episodes/user-123/story-789/001/episode.md",
          pdfS3Key: "episodes/user-123/story-789/001/episode.pdf",
          status: "COMPLETED" as const,
          createdAt: "2024-01-01T00:30:00.000Z",
        },
        {
          PK: `STORY#${mockStoryId}`,
          SK: "EPISODE#002",
          GSI1PK: "EPISODE#episode-002",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#PROCESSING",
          GSI2SK: "2024-01-01T01:00:00.000Z",
          episodeId: "episode-002",
          episodeNumber: 2,
          storyId: mockStoryId,
          s3Key: "episodes/user-123/story-789/002/episode.md",
          status: "PROCESSING" as const,
          createdAt: "2024-01-01T01:00:00.000Z",
        },
      ];

      mockStoryAccess.get.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue(
        mockExistingEpisodes
      );

      const event = {
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.statusCode).toBe(409);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "EPISODE_ALREADY_EXISTS",
        message: "Episode 2 already exists with status: PROCESSING",
        episodeId: "episode-002",
        episodeNumber: 2,
        status: "PROCESSING",
        requestId: "api-request-123",
        timestamp: expect.any(String),
      });
    });

    it("should handle authentication errors properly", async () => {
      const event = {
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
        },
        body: null,
        requestContext: {
          requestId: "api-request-123",
          // No authorizer - simulating unauthenticated request
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.statusCode).toBe(401);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "UNAUTHORIZED",
        message: "Authentication required",
        requestId: "api-request-123",
        timestamp: expect.any(String),
      });
    });

    it("should handle missing storyId path parameter", async () => {
      const event = {
        httpMethod: "POST",
        path: "/stories//episodes",
        pathParameters: null, // Missing storyId
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Story ID is required in path",
        requestId: "api-request-123",
        timestamp: expect.any(String),
      });
    });

    it("should handle unsupported HTTP methods", async () => {
      const event = {
        httpMethod: "GET", // Should be POST
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.statusCode).toBe(405);
      expect(result.headers).toEqual(
        expect.objectContaining({
          Allow: "POST",
        })
      );
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "METHOD_NOT_ALLOWED",
        message: "HTTP method GET not allowed. Use POST.",
        requestId: "api-request-123",
        timestamp: expect.any(String),
      });
    });

    it("should handle rate limiting", async () => {
      // Import the mocked RateLimiter to control its behavior
      const { RateLimiter } = require("../../utils/input-validation");

      // Mock rate limiter to return false after a few calls (rate limit exceeded)
      let callCount = 0;
      RateLimiter.isAllowed.mockImplementation(() => {
        callCount++;
        return callCount <= 5; // Allow first 5 calls, then rate limit
      });

      const mockStory = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Adventure Story",
        s3Key: "stories/user-123/story-789/story.md",
        status: "COMPLETED" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockStoryAccess.get.mockResolvedValue(mockStory);

      // Simulate multiple rapid requests to trigger rate limiting
      const events = Array.from({ length: 8 }, (_, i) => ({
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: null,
        requestContext: {
          requestId: `api-request-${i}`,
          authorizer: {
            claims: {
              sub: mockUserId,
              email: "test@example.com",
            },
          },
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      }));

      // Execute requests sequentially to ensure rate limiting logic is triggered
      const results = [];
      for (const event of events) {
        const result = await continueEpisodeHandler(event as any);
        results.push(result);
      }

      // At least some requests should be rate limited (429)
      const rateLimitedResults = results.filter(
        (result) => result.statusCode === 429
      );
      expect(rateLimitedResults.length).toBeGreaterThan(0);

      // Check rate limit response format
      if (rateLimitedResults.length > 0) {
        const rateLimitResponse = JSON.parse(rateLimitedResults[0].body);
        expect(rateLimitResponse.error).toMatchObject({
          code: "RATE_LIMIT_EXCEEDED",
          message:
            "Too many episode continuation requests. Please try again later.",
          timestamp: expect.any(String),
        });
        expect(rateLimitedResults[0].headers).toEqual(
          expect.objectContaining({
            "Retry-After": "300",
          })
        );
      }
    });

    it("should handle preferences not found error", async () => {
      const mockStory = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Adventure Story",
        s3Key: "stories/user-123/story-789/story.md",
        status: "COMPLETED" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockStoryAccess.get.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([]);
      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: null,
        insights: null,
        lastUpdated: null,
      });

      const event = {
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "PREFERENCES_NOT_FOUND",
        message:
          "User preferences not found. Cannot continue episode without original preferences.",
        requestId: "api-request-123",
        timestamp: expect.any(String),
      });
    });

    it("should handle internal server errors gracefully", async () => {
      mockStoryAccess.get.mockRejectedValue(
        new Error("DynamoDB connection timeout")
      );

      const event = {
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
        requestId: "api-request-123",
        timestamp: expect.any(String),
      });
    });
  });

  describe("Path Parameter Validation", () => {
    it("should validate storyId format", async () => {
      const invalidStoryIds = ["", "   ", "invalid-id-with-spaces"];

      for (const invalidStoryId of invalidStoryIds) {
        const event = {
          httpMethod: "POST",
          path: `/stories/${invalidStoryId}/episodes`,
          pathParameters: { storyId: invalidStoryId },
          queryStringParameters: null,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid-jwt-token",
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
            identity: {
              sourceIp: "192.168.1.1",
            },
          },
        };

        const result = await continueEpisodeHandler(event as any);

        // Should handle invalid story IDs gracefully
        expect([400, 404]).toContain(result.statusCode);
      }
    });
  });

  describe("Security Headers", () => {
    it("should include security headers in all responses", async () => {
      mockStoryAccess.get.mockResolvedValue(null);

      const event = {
        httpMethod: "POST",
        path: `/stories/${mockStoryId}/episodes`,
        pathParameters: { storyId: mockStoryId },
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
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
          identity: {
            sourceIp: "192.168.1.1",
          },
        },
      };

      const result = await continueEpisodeHandler(event as any);

      expect(result.headers).toEqual(
        expect.objectContaining({
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "X-XSS-Protection": "1; mode=block",
          "Strict-Transport-Security":
            "max-age=31536000; includeSubDomains; preload",
          "Content-Security-Policy": "default-src 'self'",
        })
      );
    });
  });
});
