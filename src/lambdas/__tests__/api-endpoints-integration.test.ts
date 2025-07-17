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

describe("API Endpoints Integration Tests", () => {
  const mockUserId = "test-user-123";
  const mockRequestId = "test-request-456";
  const mockStoryId = "test-story-789";

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  describe("POST /preferences Endpoint Integration", () => {
    it("should handle complete preferences submission workflow", async () => {
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
          {
            category: "theme",
            score: 0.8,
            attributes: { engagement: "high", demographic: "teens" },
          },
        ],
        trends: [
          { topic: "superhero", popularity: 85 },
          { topic: "friendship", popularity: 78 },
        ],
      };

      // Mock successful flow
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
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify(validPreferences),
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

      // Verify response structure
      expect(result.statusCode).toBe(200);
      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      });

      const response = JSON.parse(result.body);
      expect(response).toMatchObject({
        success: true,
        data: {
          status: "PROCESSING",
          message:
            "Preferences submitted successfully. Story generation has been initiated.",
          estimatedCompletionTime: "2-3 minutes",
        },
        timestamp: expect.any(String),
      });
      expect(response.data.requestId).toBeDefined();

      // Verify all integration steps were called correctly
      expect(mockGenerationRequestAccess.create).toHaveBeenCalledWith({
        requestId: expect.any(String),
        userId: mockUserId,
        type: "STORY",
        status: "PENDING",
        createdAt: expect.any(String),
      });

      expect(mockQlooApiClient.prototype.fetchInsights).toHaveBeenCalledWith(
        validPreferences
      );

      expect(mockUserPreferencesAccess.create).toHaveBeenCalledWith(
        mockUserId,
        {
          preferences: validPreferences,
          insights: mockInsights,
        }
      );

      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        mockUserId,
        expect.any(String),
        "PROCESSING"
      );

      expect(
        mockEventPublishingHelpers.publishStoryGeneration
      ).toHaveBeenCalledWith(
        mockUserId,
        expect.any(String),
        validPreferences,
        mockInsights
      );
    });

    it("should handle request validation errors with proper HTTP status codes", async () => {
      const invalidPreferences = {
        genres: [], // Invalid: empty array
        themes: ["ValidTheme"],
        artStyle: "InvalidStyle", // Invalid: not in enum
        targetAudience: "Teens",
        // Missing contentRating
      };

      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify(invalidPreferences),
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
      expect(response.error).toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("At least one genre must be selected"),
        timestamp: expect.any(String),
      });

      // Verify no database operations were attempted
      expect(mockGenerationRequestAccess.create).not.toHaveBeenCalled();
      expect(mockQlooApiClient.prototype.fetchInsights).not.toHaveBeenCalled();
    });

    it("should handle authentication errors properly", async () => {
      const validPreferences = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validPreferences),
        requestContext: {
          requestId: "api-request-123",
          // No authorizer - simulating unauthenticated request
        },
      };

      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(401);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
        timestamp: expect.any(String),
      });
    });
  });

  describe("GET /status/{requestId} Endpoint Integration", () => {
    it("should return detailed status for completed story generation", async () => {
      const mockRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T01:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY" as const,
        status: "COMPLETED" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T01:00:00.000Z",
        relatedEntityId: mockStoryId,
      };

      const mockStory = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Generated Adventure Story",
        s3Key: "stories/user-123/story-789/story.md",
        status: "COMPLETED" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockEpisodes = [
        {
          PK: `STORY#${mockStoryId}`,
          SK: "EPISODE#001",
          GSI1PK: "EPISODE#episode-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#COMPLETED",
          GSI2SK: "2024-01-01T00:30:00.000Z",
          episodeId: "episode-123",
          episodeNumber: 1,
          storyId: mockStoryId,
          s3Key: "episodes/user-123/story-789/001/episode.md",
          pdfS3Key: "episodes/user-123/story-789/001/episode.pdf",
          status: "COMPLETED" as const,
          createdAt: "2024-01-01T00:30:00.000Z",
        },
      ];

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue(mockEpisodes);

      const event = {
        httpMethod: "GET",
        path: `/status/${mockRequestId}`,
        pathParameters: { requestId: mockRequestId },
        queryStringParameters: null,
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
        body: null,
        requestContext: {
          requestId: "api-request-456",
          authorizer: {
            claims: {
              sub: mockUserId,
              email: "test@example.com",
            },
          },
        },
      };

      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      });

      const response = JSON.parse(result.body);
      expect(response).toMatchObject({
        requestId: mockRequestId,
        status: "COMPLETED",
        type: "STORY",
        timestamp: "2024-01-01T01:00:00.000Z",
        progress: {
          currentStep: "All episodes completed",
          totalSteps: 3,
          completedSteps: 3,
        },
        result: {
          storyId: mockStoryId,
          downloadUrl: `/api/stories/${mockStoryId}/download`,
        },
      });
    });

    it("should return processing status with progress information", async () => {
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
        updatedAt: "2024-01-01T00:15:00.000Z",
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
        title: "Adventure Story in Progress",
        s3Key: "stories/user-123/story-789/story.md",
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
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
        body: null,
        requestContext: {
          requestId: "api-request-456",
          authorizer: {
            claims: {
              sub: mockUserId,
              email: "test@example.com",
            },
          },
        },
      };

      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toMatchObject({
        requestId: mockRequestId,
        status: "PROCESSING",
        type: "STORY",
        timestamp: "2024-01-01T00:15:00.000Z",
        progress: {
          currentStep: "Generating story content",
          totalSteps: 3,
          completedSteps: 1,
        },
        result: {
          storyId: mockStoryId,
        },
      });
    });

    it("should handle authorization errors for accessing other user's requests", async () => {
      const otherUserRequest = {
        PK: `USER#other-user-456`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: "other-user-456",
        type: "STORY" as const,
        status: "COMPLETED" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(
        otherUserRequest
      );

      const event = {
        httpMethod: "GET",
        path: `/status/${mockRequestId}`,
        pathParameters: { requestId: mockRequestId },
        queryStringParameters: null,
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
        body: null,
        requestContext: {
          requestId: "api-request-456",
          authorizer: {
            claims: {
              sub: mockUserId, // Different user trying to access
              email: "test@example.com",
            },
          },
        },
      };

      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(403);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "FORBIDDEN",
        message: "Access denied to this generation request",
        timestamp: expect.any(String),
      });
    });

    it("should handle non-existent request IDs", async () => {
      const nonExistentRequestId = "non-existent-request-123";

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(null);

      const event = {
        httpMethod: "GET",
        path: `/status/${nonExistentRequestId}`,
        pathParameters: { requestId: nonExistentRequestId },
        queryStringParameters: null,
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
        body: null,
        requestContext: {
          requestId: "api-request-456",
          authorizer: {
            claims: {
              sub: mockUserId,
              email: "test@example.com",
            },
          },
        },
      };

      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(404);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "REQUEST_NOT_FOUND",
        message: "Generation request not found",
        timestamp: expect.any(String),
      });
    });
  });

  describe("End-to-End API Workflow", () => {
    it("should handle complete preferences to status check workflow", async () => {
      const validPreferences = {
        genres: ["Action", "Adventure", "Fantasy"],
        themes: ["Friendship", "Good vs Evil", "Coming of Age"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const mockInsights = {
        recommendations: [
          {
            category: "genre",
            score: 0.95,
            attributes: { popularity: "very_high", trending: true },
          },
          {
            category: "theme",
            score: 0.88,
            attributes: { engagement: "high", demographic: "teens" },
          },
        ],
        trends: [
          { topic: "superhero", popularity: 92 },
          { topic: "friendship", popularity: 85 },
          { topic: "adventure", popularity: 78 },
        ],
      };

      // Step 1: Submit preferences
      mockGenerationRequestAccess.create.mockResolvedValue();
      mockQlooApiClient.prototype.fetchInsights.mockResolvedValue(mockInsights);
      mockUserPreferencesAccess.create.mockResolvedValue();
      mockGenerationRequestAccess.updateStatus.mockResolvedValue();
      mockEventPublishingHelpers.publishStoryGeneration.mockResolvedValue();

      const preferencesEvent = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify(validPreferences),
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

      const preferencesResult = await preferencesHandler(
        preferencesEvent as any
      );

      expect(preferencesResult.statusCode).toBe(200);
      const preferencesResponse = JSON.parse(preferencesResult.body);
      const generatedRequestId = preferencesResponse.data.requestId;

      // Step 2: Check status immediately (should be PROCESSING)
      const mockProcessingRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${generatedRequestId}`,
        GSI1PK: `REQUEST#${generatedRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: generatedRequestId,
        userId: mockUserId,
        type: "STORY" as const,
        status: "PROCESSING" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:05:00.000Z",
        relatedEntityId: mockStoryId,
      };

      const mockProcessingStory = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Epic Adventure Story",
        s3Key: "stories/user-123/story-789/story.md",
        status: "PROCESSING" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(
        mockProcessingRequest
      );
      mockStoryAccess.getByStoryId.mockResolvedValue(mockProcessingStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([]);

      const statusEvent = {
        httpMethod: "GET",
        path: `/status/${generatedRequestId}`,
        pathParameters: { requestId: generatedRequestId },
        queryStringParameters: null,
        headers: {
          Authorization: "Bearer valid-jwt-token",
        },
        body: null,
        requestContext: {
          requestId: "api-request-456",
          authorizer: {
            claims: {
              sub: mockUserId,
              email: "test@example.com",
            },
          },
        },
      };

      const statusResult = await statusHandler(statusEvent as any);

      expect(statusResult.statusCode).toBe(200);
      const statusResponse = JSON.parse(statusResult.body);

      expect(statusResponse).toMatchObject({
        requestId: generatedRequestId,
        status: "PROCESSING",
        type: "STORY",
        timestamp: "2024-01-01T00:05:00.000Z",
        progress: {
          currentStep: "Generating story content",
          totalSteps: 3,
          completedSteps: 1,
        },
        result: {
          storyId: mockStoryId,
        },
      });

      // Step 3: Simulate completion and check final status
      const mockCompletedRequest = {
        ...mockProcessingRequest,
        status: "COMPLETED" as const,
        updatedAt: "2024-01-01T01:00:00.000Z",
      };

      const mockCompletedStory = {
        ...mockProcessingStory,
        status: "COMPLETED" as const,
        updatedAt: "2024-01-01T01:00:00.000Z",
      };

      const mockCompletedEpisodes = [
        {
          PK: `STORY#${mockStoryId}`,
          SK: "EPISODE#001",
          GSI1PK: "EPISODE#episode-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#COMPLETED",
          GSI2SK: "2024-01-01T00:45:00.000Z",
          episodeId: "episode-123",
          episodeNumber: 1,
          storyId: mockStoryId,
          s3Key: "episodes/user-123/story-789/001/episode.md",
          pdfS3Key: "episodes/user-123/story-789/001/episode.pdf",
          status: "COMPLETED" as const,
          createdAt: "2024-01-01T00:30:00.000Z",
        },
      ];

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(
        mockCompletedRequest
      );
      mockStoryAccess.getByStoryId.mockResolvedValue(mockCompletedStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue(
        mockCompletedEpisodes
      );

      const finalStatusResult = await statusHandler(statusEvent as any);

      expect(finalStatusResult.statusCode).toBe(200);
      const finalStatusResponse = JSON.parse(finalStatusResult.body);

      expect(finalStatusResponse).toMatchObject({
        requestId: generatedRequestId,
        status: "COMPLETED",
        type: "STORY",
        timestamp: "2024-01-01T01:00:00.000Z",
        progress: {
          currentStep: "All episodes completed",
          totalSteps: 3,
          completedSteps: 3,
        },
        result: {
          storyId: mockStoryId,
          downloadUrl: `/api/stories/${mockStoryId}/download`,
        },
      });
    });
  });

  describe("Error Recovery and Resilience", () => {
    it("should handle partial failures gracefully", async () => {
      const validPreferences = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      // Simulate Qloo API failure after successful request creation
      mockGenerationRequestAccess.create.mockResolvedValue();
      mockQlooApiClient.prototype.fetchInsights.mockRejectedValue(
        new Error("Qloo API temporarily unavailable")
      );
      mockGenerationRequestAccess.updateStatus.mockResolvedValue();

      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify(validPreferences),
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

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "QLOO_API_ERROR",
        message: "Failed to process user preferences. Please try again later.",
        timestamp: expect.any(String),
      });

      // Verify that the request was marked as failed
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        mockUserId,
        expect.any(String),
        "FAILED",
        { errorMessage: "Failed to fetch user insights from Qloo API" }
      );
    });

    it("should handle database connectivity issues", async () => {
      const validPreferences = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      // Simulate database connection failure
      mockGenerationRequestAccess.create.mockRejectedValue(
        new Error("DynamoDB connection timeout")
      );

      const event = {
        httpMethod: "POST",
        path: "/preferences",
        pathParameters: null,
        queryStringParameters: null,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify(validPreferences),
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

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error).toMatchObject({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred. Please try again later.",
        timestamp: expect.any(String),
      });
    });
  });
});
