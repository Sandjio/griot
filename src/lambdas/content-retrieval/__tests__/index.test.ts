import { handler } from "../index";
import {
  StoryAccess,
  EpisodeAccess,
  BatchOperations,
} from "../../../database/access-patterns";
import { Story, Episode } from "../../../types/data-models";

// Mock the database access patterns
jest.mock("../../../database/access-patterns");

const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockBatchOperations = BatchOperations as jest.Mocked<
  typeof BatchOperations
>;

describe("Content Retrieval Lambda", () => {
  const mockUserId = "test-user-123";
  const mockStoryId = "story-456";
  const mockEpisodeId = "episode-789";
  const mockRequestId = "req-123";
  const mockTimestamp = "2024-01-01T00:00:00.000Z";

  const mockEvent = {
    httpMethod: "GET",
    path: "/stories",
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    body: null,
    requestContext: {
      requestId: mockRequestId,
      authorizer: {
        claims: {
          sub: mockUserId,
          email: "test@example.com",
        },
      },
    },
  };

  const mockStory: Story = {
    PK: `USER#${mockUserId}`,
    SK: `STORY#${mockStoryId}`,
    GSI1PK: `STORY#${mockStoryId}`,
    GSI1SK: "METADATA",
    GSI2PK: "STATUS#COMPLETED",
    GSI2SK: mockTimestamp,
    storyId: mockStoryId,
    title: "Test Story",
    s3Key: "stories/test-story.md",
    status: "COMPLETED",
    userId: mockUserId,
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
  };

  const mockEpisode: Episode = {
    PK: `STORY#${mockStoryId}`,
    SK: "EPISODE#001",
    GSI1PK: `EPISODE#${mockEpisodeId}`,
    GSI1SK: "METADATA",
    GSI2PK: "STATUS#COMPLETED",
    GSI2SK: mockTimestamp,
    episodeId: mockEpisodeId,
    episodeNumber: 1,
    storyId: mockStoryId,
    s3Key: "episodes/test-episode.md",
    pdfS3Key: "episodes/test-episode.pdf",
    status: "COMPLETED",
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock Date.now() to return consistent timestamp
    jest.spyOn(Date.prototype, "toISOString").mockReturnValue(mockTimestamp);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /stories", () => {
    it("should return user stories successfully", async () => {
      mockStoryAccess.getUserStories.mockResolvedValue([mockStory]);

      const result = await handler({
        ...mockEvent,
        path: "/stories",
      } as any);

      expect(result.statusCode).toBe(200);
      expect(mockStoryAccess.getUserStories).toHaveBeenCalledWith(
        mockUserId,
        20
      );

      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.data.stories).toHaveLength(1);
      expect(body.data.stories[0]).toEqual({
        storyId: mockStoryId,
        title: "Test Story",
        status: "COMPLETED",
        s3Key: "stories/test-story.md",
        createdAt: mockTimestamp,
        updatedAt: mockTimestamp,
      });
    });

    it("should handle query parameters correctly", async () => {
      mockStoryAccess.getUserStories.mockResolvedValue([mockStory]);

      const result = await handler({
        ...mockEvent,
        path: "/stories",
        queryStringParameters: {
          limit: "10",
          status: "COMPLETED",
        },
      } as any);

      expect(result.statusCode).toBe(200);
      expect(mockStoryAccess.getUserStories).toHaveBeenCalledWith(
        mockUserId,
        10
      );

      const body = JSON.parse(result.body);
      expect(body.data.stories).toHaveLength(1);
    });

    it("should filter stories by status", async () => {
      const pendingStory = { ...mockStory, status: "PENDING" as const };
      mockStoryAccess.getUserStories.mockResolvedValue([
        mockStory,
        pendingStory,
      ]);

      const result = await handler({
        ...mockEvent,
        path: "/stories",
        queryStringParameters: {
          status: "COMPLETED",
        },
      } as any);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data.stories).toHaveLength(1);
      expect(body.data.stories[0].status).toBe("COMPLETED");
    });

    it("should handle empty results", async () => {
      mockStoryAccess.getUserStories.mockResolvedValue([]);

      const result = await handler({
        ...mockEvent,
        path: "/stories",
      } as any);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data.stories).toHaveLength(0);
      expect(body.data.count).toBe(0);
    });

    it("should handle database errors", async () => {
      mockStoryAccess.getUserStories.mockRejectedValue(
        new Error("Database error")
      );

      const result = await handler({
        ...mockEvent,
        path: "/stories",
      } as any);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("FETCH_ERROR");
    });
  });

  describe("GET /stories/{storyId}", () => {
    it("should return story with episodes successfully", async () => {
      mockBatchOperations.getStoryWithEpisodes.mockResolvedValue({
        story: mockStory,
        episodes: [mockEpisode],
      });

      const result = await handler({
        ...mockEvent,
        path: `/stories/${mockStoryId}`,
        pathParameters: { storyId: mockStoryId },
      } as any);

      expect(result.statusCode).toBe(200);
      expect(mockBatchOperations.getStoryWithEpisodes).toHaveBeenCalledWith(
        mockStoryId
      );

      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.data.story.storyId).toBe(mockStoryId);
      expect(body.data.episodes).toHaveLength(1);
      expect(body.data.episodes[0].episodeId).toBe(mockEpisodeId);
    });

    it("should return 404 when story not found", async () => {
      mockBatchOperations.getStoryWithEpisodes.mockResolvedValue({
        story: null,
        episodes: [],
      });

      const result = await handler({
        ...mockEvent,
        path: `/stories/${mockStoryId}`,
        pathParameters: { storyId: mockStoryId },
      } as any);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("STORY_NOT_FOUND");
    });

    it("should return 403 when user doesn't own story", async () => {
      const otherUserStory = {
        ...mockStory,
        PK: "USER#other-user",
        userId: "other-user",
      };

      mockBatchOperations.getStoryWithEpisodes.mockResolvedValue({
        story: otherUserStory,
        episodes: [],
      });

      const result = await handler({
        ...mockEvent,
        path: `/stories/${mockStoryId}`,
        pathParameters: { storyId: mockStoryId },
      } as any);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("ACCESS_DENIED");
    });

    it("should return 400 when storyId is missing", async () => {
      const result = await handler({
        ...mockEvent,
        path: "/stories/",
        pathParameters: null,
      } as any);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("INVALID_PATH");
    });

    it("should handle database errors", async () => {
      mockBatchOperations.getStoryWithEpisodes.mockRejectedValue(
        new Error("Database error")
      );

      const result = await handler({
        ...mockEvent,
        path: `/stories/${mockStoryId}`,
        pathParameters: { storyId: mockStoryId },
      } as any);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("FETCH_ERROR");
    });
  });

  describe("GET /episodes/{episodeId}", () => {
    it("should return episode successfully", async () => {
      mockEpisodeAccess.getByEpisodeId.mockResolvedValue(mockEpisode);
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);

      const result = await handler({
        ...mockEvent,
        path: `/episodes/${mockEpisodeId}`,
        pathParameters: { episodeId: mockEpisodeId },
      } as any);

      expect(result.statusCode).toBe(200);
      expect(mockEpisodeAccess.getByEpisodeId).toHaveBeenCalledWith(
        mockEpisodeId
      );
      expect(mockStoryAccess.getByStoryId).toHaveBeenCalledWith(mockStoryId);

      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.data.episode.episodeId).toBe(mockEpisodeId);
      expect(body.data.story.storyId).toBe(mockStoryId);
    });

    it("should return 404 when episode not found", async () => {
      mockEpisodeAccess.getByEpisodeId.mockResolvedValue(null);

      const result = await handler({
        ...mockEvent,
        path: `/episodes/${mockEpisodeId}`,
        pathParameters: { episodeId: mockEpisodeId },
      } as any);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("EPISODE_NOT_FOUND");
    });

    it("should return 403 when user doesn't own episode", async () => {
      const otherUserStory = {
        ...mockStory,
        PK: "USER#other-user",
        userId: "other-user",
      };

      mockEpisodeAccess.getByEpisodeId.mockResolvedValue(mockEpisode);
      mockStoryAccess.getByStoryId.mockResolvedValue(otherUserStory);

      const result = await handler({
        ...mockEvent,
        path: `/episodes/${mockEpisodeId}`,
        pathParameters: { episodeId: mockEpisodeId },
      } as any);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("ACCESS_DENIED");
    });

    it("should return 403 when story not found", async () => {
      mockEpisodeAccess.getByEpisodeId.mockResolvedValue(mockEpisode);
      mockStoryAccess.getByStoryId.mockResolvedValue(null);

      const result = await handler({
        ...mockEvent,
        path: `/episodes/${mockEpisodeId}`,
        pathParameters: { episodeId: mockEpisodeId },
      } as any);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("ACCESS_DENIED");
    });

    it("should return 400 when episodeId is missing", async () => {
      const result = await handler({
        ...mockEvent,
        path: "/episodes/",
        pathParameters: null,
      } as any);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("INVALID_PATH");
    });

    it("should handle database errors", async () => {
      mockEpisodeAccess.getByEpisodeId.mockRejectedValue(
        new Error("Database error")
      );

      const result = await handler({
        ...mockEvent,
        path: `/episodes/${mockEpisodeId}`,
        pathParameters: { episodeId: mockEpisodeId },
      } as any);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("FETCH_ERROR");
    });
  });

  describe("Error handling", () => {
    it("should return 404 for unsupported endpoints", async () => {
      const result = await handler({
        ...mockEvent,
        path: "/unsupported",
        httpMethod: "GET",
      } as any);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("should return 404 for unsupported methods", async () => {
      const result = await handler({
        ...mockEvent,
        path: "/stories",
        httpMethod: "POST",
      } as any);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("should include CORS headers in all responses", async () => {
      mockStoryAccess.getUserStories.mockResolvedValue([]);

      const result = await handler({
        ...mockEvent,
        path: "/stories",
      } as any);

      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
      });
    });

    it("should include request ID and timestamp in all responses", async () => {
      mockStoryAccess.getUserStories.mockResolvedValue([]);

      const result = await handler({
        ...mockEvent,
        path: "/stories",
      } as any);

      const body = JSON.parse(result.body);
      expect(body.requestId).toBe(mockRequestId);
      expect(body.timestamp).toBe(mockTimestamp);
    });
  });

  describe("Response transformation", () => {
    it("should remove internal DynamoDB keys from story response", async () => {
      mockStoryAccess.getUserStories.mockResolvedValue([mockStory]);

      const result = await handler({
        ...mockEvent,
        path: "/stories",
      } as any);

      const body = JSON.parse(result.body);
      const story = body.data.stories[0];

      // Should include these fields
      expect(story).toHaveProperty("storyId");
      expect(story).toHaveProperty("title");
      expect(story).toHaveProperty("status");
      expect(story).toHaveProperty("s3Key");
      expect(story).toHaveProperty("createdAt");
      expect(story).toHaveProperty("updatedAt");

      // Should NOT include these internal fields
      expect(story).not.toHaveProperty("PK");
      expect(story).not.toHaveProperty("SK");
      expect(story).not.toHaveProperty("GSI1PK");
      expect(story).not.toHaveProperty("GSI1SK");
      expect(story).not.toHaveProperty("GSI2PK");
      expect(story).not.toHaveProperty("GSI2SK");
      expect(story).not.toHaveProperty("userId");
    });

    it("should remove internal DynamoDB keys from episode response", async () => {
      mockEpisodeAccess.getByEpisodeId.mockResolvedValue(mockEpisode);
      mockStoryAccess.getByStoryId.mockResolvedValue(mockStory);

      const result = await handler({
        ...mockEvent,
        path: `/episodes/${mockEpisodeId}`,
        pathParameters: { episodeId: mockEpisodeId },
      } as any);

      const body = JSON.parse(result.body);
      const episode = body.data.episode;

      // Should include these fields
      expect(episode).toHaveProperty("episodeId");
      expect(episode).toHaveProperty("episodeNumber");
      expect(episode).toHaveProperty("storyId");
      expect(episode).toHaveProperty("status");
      expect(episode).toHaveProperty("s3Key");
      expect(episode).toHaveProperty("pdfS3Key");
      expect(episode).toHaveProperty("createdAt");
      expect(episode).toHaveProperty("updatedAt");

      // Should NOT include these internal fields
      expect(episode).not.toHaveProperty("PK");
      expect(episode).not.toHaveProperty("SK");
      expect(episode).not.toHaveProperty("GSI1PK");
      expect(episode).not.toHaveProperty("GSI1SK");
      expect(episode).not.toHaveProperty("GSI2PK");
      expect(episode).not.toHaveProperty("GSI2SK");
    });
  });
});
