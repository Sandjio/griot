import { handler as preferencesHandler } from "../preferences-processing/index";
import { handler as statusHandler } from "../status-check/index";
import {
  GenerationRequestAccess,
  UserPreferencesAccess,
  StoryAccess,
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
const mockQlooApiClient = QlooApiClient as jest.MockedClass<
  typeof QlooApiClient
>;
const mockEventPublishingHelpers = EventPublishingHelpers as jest.Mocked<
  typeof EventPublishingHelpers
>;

describe("API Integration Tests", () => {
  const mockUserId = "test-user-123";
  const mockRequestId = "test-request-456";
  const mockStoryId = "test-story-789";

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  describe("POST /preferences Integration", () => {
    const createPreferencesEvent = (body: any, userId?: string) => ({
      httpMethod: "POST",
      path: "/preferences",
      pathParameters: null,
      queryStringParameters: null,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

    it("should successfully process valid preferences", async () => {
      const validPreferences = {
        genres: ["Action", "Adventure"],
        themes: ["Friendship", "Good vs Evil"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const mockInsights = {
        recommendations: [
          { category: "genre", score: 0.9, attributes: { popularity: "high" } },
        ],
        trends: [{ topic: "superhero", popularity: 85 }],
      };

      // Mock successful flow
      mockGenerationRequestAccess.create.mockResolvedValue();
      mockQlooApiClient.prototype.fetchInsights.mockResolvedValue(mockInsights);
      mockUserPreferencesAccess.create.mockResolvedValue();
      mockGenerationRequestAccess.updateStatus.mockResolvedValue();
      mockEventPublishingHelpers.publishStoryGeneration.mockResolvedValue();

      const event = createPreferencesEvent(validPreferences, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        status: "PROCESSING",
        message:
          "Preferences submitted successfully. Story generation has been initiated.",
        estimatedCompletionTime: "2-3 minutes",
      });
      expect(response.data.requestId).toBeDefined();

      // Verify all steps were called
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
      expect(
        mockEventPublishingHelpers.publishStoryGeneration
      ).toHaveBeenCalled();
    });

    it("should reject invalid preferences with detailed validation errors", async () => {
      const invalidPreferences = {
        genres: [], // Empty array
        themes: ["InvalidTheme"], // Invalid theme
        artStyle: "InvalidStyle", // Invalid art style
        targetAudience: "", // Empty string
        // Missing contentRating
      };

      const event = createPreferencesEvent(invalidPreferences, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(400);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toContain(
        "At least one genre must be selected"
      );
      expect(response.error.message).toContain("Invalid themes");
      expect(response.error.message).toContain("Invalid art style");
      expect(response.error.message).toContain("Content rating is required");
    });

    it("should handle Qloo API failures gracefully", async () => {
      const validPreferences = {
        genres: ["Action"],
        themes: ["Friendship"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      // Mock Qloo API failure
      mockGenerationRequestAccess.create.mockResolvedValue();
      mockQlooApiClient.prototype.fetchInsights.mockRejectedValue(
        new Error("Qloo API timeout")
      );
      mockGenerationRequestAccess.updateStatus.mockResolvedValue();

      const event = createPreferencesEvent(validPreferences, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("QLOO_API_ERROR");
      expect(response.error.message).toBe(
        "Failed to process user preferences. Please try again later."
      );

      // Verify request was marked as failed
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        mockUserId,
        expect.any(String),
        "FAILED",
        { errorMessage: "Failed to fetch user insights from Qloo API" }
      );
    });

    it("should handle database failures gracefully", async () => {
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

      // Mock database failure
      mockGenerationRequestAccess.create.mockResolvedValue();
      mockQlooApiClient.prototype.fetchInsights.mockResolvedValue(mockInsights);
      mockUserPreferencesAccess.create.mockRejectedValue(
        new Error("DynamoDB connection failed")
      );
      mockGenerationRequestAccess.updateStatus.mockResolvedValue();

      const event = createPreferencesEvent(validPreferences, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("DATABASE_ERROR");
      expect(response.error.message).toBe(
        "Failed to save preferences. Please try again later."
      );
    });

    it("should handle event publishing failures gracefully", async () => {
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

      // Mock event publishing failure
      mockGenerationRequestAccess.create.mockResolvedValue();
      mockQlooApiClient.prototype.fetchInsights.mockResolvedValue(mockInsights);
      mockUserPreferencesAccess.create.mockResolvedValue();
      mockGenerationRequestAccess.updateStatus.mockResolvedValue();
      mockEventPublishingHelpers.publishStoryGeneration.mockRejectedValue(
        new Error("EventBridge failure")
      );

      const event = createPreferencesEvent(validPreferences, mockUserId);
      const result = await preferencesHandler(event as any);

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error.code).toBe("EVENT_PUBLISHING_ERROR");
      expect(response.error.message).toBe(
        "Failed to initiate story generation. Please try again later."
      );
    });
  });

  describe("GET /status/{requestId} Integration", () => {
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

    it("should return complete story generation status", async () => {
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
        title: "Test Story",
        s3Key: "stories/test-story.md",
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
          s3Key: "episodes/test-episode.md",
          pdfS3Key: "episodes/test-episode.pdf",
          status: "COMPLETED" as const,
          createdAt: "2024-01-01T00:30:00.000Z",
        },
      ];

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      // Mock the EpisodeAccess import
      const { EpisodeAccess } = require("../../database/access-patterns");
      EpisodeAccess.getStoryEpisodes = jest
        .fn()
        .mockResolvedValue(mockEpisodes);

      const event = createStatusEvent(mockRequestId, mockUserId);
      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(200);
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
      // Mock the EpisodeAccess import
      const { EpisodeAccess } = require("../../database/access-patterns");
      EpisodeAccess.getStoryEpisodes = jest.fn().mockResolvedValue([]);

      const event = createStatusEvent(mockRequestId, mockUserId);
      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toMatchObject({
        requestId: mockRequestId,
        status: "PROCESSING",
        type: "STORY",
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

    it("should return failed status with error message", async () => {
      const mockRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#FAILED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY" as const,
        status: "FAILED" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
        errorMessage: "Qloo API integration failed",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const event = createStatusEvent(mockRequestId, mockUserId);
      const result = await statusHandler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toMatchObject({
        requestId: mockRequestId,
        status: "FAILED",
        type: "STORY",
        error: "Qloo API integration failed",
      });
    });
  });

  describe("End-to-End Workflow Integration", () => {
    it("should handle complete preferences submission to status check workflow", async () => {
      const validPreferences = {
        genres: ["Action", "Adventure"],
        themes: ["Friendship", "Good vs Evil"],
        artStyle: "Traditional",
        targetAudience: "Teens",
        contentRating: "PG-13",
      };

      const mockInsights = {
        recommendations: [
          { category: "genre", score: 0.9, attributes: { popularity: "high" } },
        ],
        trends: [{ topic: "superhero", popularity: 85 }],
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPreferences),
        requestContext: {
          requestId: "api-request-123",
          authorizer: {
            claims: { sub: mockUserId, email: "test@example.com" },
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
        relatedEntityId: mockStoryId,
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(
        mockProcessingRequest
      );
      mockStoryAccess.getByStoryId.mockResolvedValue({
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Generated Story",
        s3Key: "stories/generated-story.md",
        status: "PROCESSING" as const,
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      });

      // Mock the EpisodeAccess import
      const { EpisodeAccess } = require("../../database/access-patterns");
      EpisodeAccess.getStoryEpisodes = jest.fn().mockResolvedValue([]);

      const statusEvent = {
        httpMethod: "GET",
        path: `/status/${generatedRequestId}`,
        pathParameters: { requestId: generatedRequestId },
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

      const statusResult = await statusHandler(statusEvent as any);
      expect(statusResult.statusCode).toBe(200);

      const statusResponse = JSON.parse(statusResult.body);
      expect(statusResponse).toMatchObject({
        requestId: generatedRequestId,
        status: "PROCESSING",
        type: "STORY",
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
  });
});
