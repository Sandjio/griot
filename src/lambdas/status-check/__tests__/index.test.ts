import { handler } from "../index";
import {
  GenerationRequestAccess,
  StoryAccess,
  EpisodeAccess,
} from "../../../database/access-patterns";
import { GenerationRequest, Story, Episode } from "../../../types/data-models";

// Mock the database access patterns
jest.mock("../../../database/access-patterns");

const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;

describe("Status Check Lambda", () => {
  const mockUserId = "test-user-123";
  const mockRequestId = "test-request-456";
  const mockStoryId = "test-story-789";
  const mockEpisodeId = "test-episode-101";

  const createMockEvent = (requestId?: string, userId?: string) => ({
    httpMethod: "GET",
    path: `/status/${requestId || mockRequestId}`,
    pathParameters: requestId ? { requestId } : null,
    queryStringParameters: null,
    headers: {},
    body: null,
    requestContext: {
      requestId: "lambda-request-123",
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

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  describe("Authentication and Authorization", () => {
    it("should return 401 when user is not authenticated", async () => {
      const event = createMockEvent(mockRequestId, undefined);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({
        error: {
          code: "UNAUTHORIZED",
          message: "User not authenticated",
          requestId: "lambda-request-123",
          timestamp: expect.any(String),
        },
      });
    });

    it("should return 400 when requestId is missing from path parameters", async () => {
      const event = createMockEvent(undefined, mockUserId);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Request ID is required in path parameters",
          requestId: "lambda-request-123",
          timestamp: expect.any(String),
        },
      });
    });

    it("should return 404 when generation request is not found", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(null);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toEqual({
        error: {
          code: "REQUEST_NOT_FOUND",
          message: "Generation request not found",
          requestId: "lambda-request-123",
          timestamp: expect.any(String),
        },
      });
      expect(mockGenerationRequestAccess.getByRequestId).toHaveBeenCalledWith(
        mockRequestId
      );
    });

    it("should return 403 when user tries to access another user's request", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      const mockRequest: GenerationRequest = {
        PK: `USER#different-user`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: "different-user",
        type: "STORY",
        status: "PROCESSING",
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body)).toEqual({
        error: {
          code: "FORBIDDEN",
          message: "Access denied to this generation request",
          requestId: "lambda-request-123",
          timestamp: expect.any(String),
        },
      });
    });
  });

  describe("Story Generation Status", () => {
    it("should return basic status for pending story request", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      const mockRequest: GenerationRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PENDING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY",
        status: "PENDING",
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toEqual({
        requestId: mockRequestId,
        status: "PENDING",
        type: "STORY",
        timestamp: "2024-01-01T00:00:00.000Z",
        progress: {
          currentStep: "Initializing story generation",
          totalSteps: 3,
          completedSteps: 0,
        },
      });
    });

    it("should return detailed status for processing story request", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      const mockRequest: GenerationRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY",
        status: "PROCESSING",
        createdAt: "2024-01-01T00:00:00.000Z",
        relatedEntityId: mockStoryId,
      };
      const mockStory: Story = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Test Story",
        s3Key: "stories/test-story.md",
        status: "PROCESSING",
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue([]);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toEqual({
        requestId: mockRequestId,
        status: "PROCESSING",
        type: "STORY",
        timestamp: "2024-01-01T00:00:00.000Z",
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

    it("should return completed status with download URL for completed story", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      const mockRequest: GenerationRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY",
        status: "COMPLETED",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T01:00:00.000Z",
        relatedEntityId: mockStoryId,
      };
      const mockStory: Story = {
        PK: `USER#${mockUserId}`,
        SK: `STORY#${mockStoryId}`,
        GSI1PK: `STORY#${mockStoryId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: mockStoryId,
        title: "Test Story",
        s3Key: "stories/test-story.md",
        status: "COMPLETED",
        userId: mockUserId,
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      const mockEpisodes: Episode[] = [
        {
          PK: `STORY#${mockStoryId}`,
          SK: "EPISODE#001",
          GSI1PK: `EPISODE#${mockEpisodeId}`,
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#COMPLETED",
          GSI2SK: "2024-01-01T00:30:00.000Z",
          episodeId: mockEpisodeId,
          episodeNumber: 1,
          storyId: mockStoryId,
          s3Key: "episodes/test-episode.md",
          pdfS3Key: "episodes/test-episode.pdf",
          status: "COMPLETED",
          createdAt: "2024-01-01T00:30:00.000Z",
        },
      ];

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);
      mockEpisodeAccess.getStoryEpisodes.mockResolvedValue(mockEpisodes);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toEqual({
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

    it("should return failed status with error message", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      const mockRequest: any = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#FAILED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY",
        status: "FAILED",
        createdAt: "2024-01-01T00:00:00.000Z",
        errorMessage: "Qloo API integration failed",
      };
      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toEqual({
        requestId: mockRequestId,
        status: "FAILED",
        type: "STORY",
        timestamp: "2024-01-01T00:00:00.000Z",
        error: "Qloo API integration failed",
      });
    });
  });

  describe("Episode Generation Status", () => {
    it("should return basic status for pending episode request", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      const mockRequest: GenerationRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PENDING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "EPISODE",
        status: "PENDING",
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toEqual({
        requestId: mockRequestId,
        status: "PENDING",
        type: "EPISODE",
        timestamp: "2024-01-01T00:00:00.000Z",
        progress: {
          currentStep: "Initializing episode generation",
          totalSteps: 2,
          completedSteps: 0,
        },
      });
    });

    it("should return completed status with download URL for completed episode", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      const mockRequest: GenerationRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "EPISODE",
        status: "COMPLETED",
        createdAt: "2024-01-01T00:00:00.000Z",
        relatedEntityId: mockEpisodeId,
      };
      const mockEpisode: Episode = {
        PK: `STORY#${mockStoryId}`,
        SK: "EPISODE#001",
        GSI1PK: `EPISODE#${mockEpisodeId}`,
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:30:00.000Z",
        episodeId: mockEpisodeId,
        episodeNumber: 1,
        storyId: mockStoryId,
        s3Key: "episodes/test-episode.md",
        pdfS3Key: "episodes/test-episode.pdf",
        status: "COMPLETED",
        createdAt: "2024-01-01T00:30:00.000Z",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);
      mockEpisodeAccess.getByEpisodeId.mockResolvedValue(mockEpisode);

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response).toEqual({
        requestId: mockRequestId,
        status: "COMPLETED",
        type: "EPISODE",
        timestamp: "2024-01-01T00:00:00.000Z",
        progress: {
          currentStep: "Episode completed",
          totalSteps: 2,
          completedSteps: 2,
        },
        result: {
          episodeId: mockEpisodeId,
          downloadUrl: `/api/episodes/${mockEpisodeId}/download`,
        },
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      mockGenerationRequestAccess.getByRequestId.mockRejectedValue(
        new Error("Database connection failed")
      );

      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred while checking status",
          requestId: "lambda-request-123",
          timestamp: expect.any(String),
        },
      });
      expect(console.error).toHaveBeenCalled();
    });

    it("should handle story access errors gracefully", async () => {
      const event = createMockEvent(mockRequestId, mockUserId);
      const mockRequest: GenerationRequest = {
        PK: `USER#${mockUserId}`,
        SK: `REQUEST#${mockRequestId}`,
        GSI1PK: `REQUEST#${mockRequestId}`,
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: mockRequestId,
        userId: mockUserId,
        type: "STORY",
        status: "PROCESSING",
        createdAt: "2024-01-01T00:00:00.000Z",
        relatedEntityId: mockStoryId,
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);
      mockStoryAccess.getByStoryId.mockRejectedValue(
        new Error("Story access failed")
      );

      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.progress.currentStep).toBe("Error retrieving progress");
      expect(response.progress.completedSteps).toBe(0);
    });
  });
});
