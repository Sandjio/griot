/**
 * Integration tests for Content Retrieval API endpoints
 * These tests verify the complete API Gateway -> Lambda -> DynamoDB flow
 */

// Mock the DynamoDB client imports first
const mockDocClient = {
  send: jest.fn(),
} as any;

jest.mock("../../database/dynamodb-client", () => ({
  docClient: mockDocClient,
  TABLE_NAME: "test-manga-table",
}));

// Mock AWS SDK for testing
jest.mock("@aws-sdk/client-dynamodb");
jest.mock("@aws-sdk/lib-dynamodb");

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { handler } from "../content-retrieval/index";
import { Story, Episode } from "../../types/data-models";

describe("Content Retrieval API Integration Tests", () => {
  const testUserId = "test-user-integration";
  const testStoryId = "story-integration-123";
  const testEpisodeId = "episode-integration-456";
  const testRequestId = "req-integration-789";
  const testTimestamp = "2024-01-01T12:00:00.000Z";

  const mockStory: Story = {
    PK: `USER#${testUserId}`,
    SK: `STORY#${testStoryId}`,
    GSI1PK: `STORY#${testStoryId}`,
    GSI1SK: "METADATA",
    GSI2PK: "STATUS#COMPLETED",
    GSI2SK: testTimestamp,
    storyId: testStoryId,
    title: "Integration Test Story",
    s3Key: `stories/${testUserId}/${testStoryId}/story.md`,
    status: "COMPLETED",
    userId: testUserId,
    createdAt: testTimestamp,
    updatedAt: testTimestamp,
  };

  const mockEpisode: Episode = {
    PK: `STORY#${testStoryId}`,
    SK: "EPISODE#001",
    GSI1PK: `EPISODE#${testEpisodeId}`,
    GSI1SK: "METADATA",
    GSI2PK: "STATUS#COMPLETED",
    GSI2SK: testTimestamp,
    episodeId: testEpisodeId,
    episodeNumber: 1,
    storyId: testStoryId,
    s3Key: `episodes/${testUserId}/${testStoryId}/001/episode.md`,
    pdfS3Key: `episodes/${testUserId}/${testStoryId}/001/episode.pdf`,
    status: "COMPLETED",
    createdAt: testTimestamp,
    updatedAt: testTimestamp,
  };

  const createMockEvent = (
    path: string,
    pathParameters?: any,
    queryStringParameters?: any
  ) => ({
    httpMethod: "GET",
    path,
    pathParameters,
    queryStringParameters,
    headers: {
      Authorization: "Bearer mock-jwt-token",
      "Content-Type": "application/json",
    },
    body: null,
    requestContext: {
      requestId: testRequestId,
      authorizer: {
        claims: {
          sub: testUserId,
          email: "integration-test@example.com",
        },
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock consistent timestamp
    jest.spyOn(Date.prototype, "toISOString").mockReturnValue(testTimestamp);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /stories Integration", () => {
    it("should retrieve user stories with proper authentication", async () => {
      // Mock DynamoDB query response for getUserStories
      mockDocClient.send.mockResolvedValueOnce({
        Items: [mockStory],
        Count: 1,
        ScannedCount: 1,
      });

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(mockDocClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: "test-manga-table",
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": `USER#${testUserId}`,
              ":sk": "STORY#",
            },
            ScanIndexForward: false,
            Limit: 20,
          }),
        })
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.stories).toHaveLength(1);
      expect(responseBody.data.stories[0]).toEqual({
        storyId: testStoryId,
        title: "Integration Test Story",
        status: "COMPLETED",
        s3Key: `stories/${testUserId}/${testStoryId}/story.md`,
        createdAt: testTimestamp,
        updatedAt: testTimestamp,
      });
    });

    it("should handle pagination parameters", async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: [mockStory],
        Count: 1,
        ScannedCount: 1,
      });

      const event = createMockEvent("/stories", null, {
        limit: "5",
        status: "COMPLETED",
      });
      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(mockDocClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Limit: 5,
          }),
        })
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody.data.stories).toHaveLength(1);
      expect(responseBody.data.stories[0].status).toBe("COMPLETED");
    });

    it("should handle empty results gracefully", async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        ScannedCount: 0,
      });

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.stories).toHaveLength(0);
      expect(responseBody.data.count).toBe(0);
    });

    it("should handle DynamoDB errors properly", async () => {
      mockDocClient.send.mockRejectedValueOnce(
        new Error("DynamoDB connection failed")
      );

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("FETCH_ERROR");
      expect(responseBody.error.message).toBe("Failed to fetch stories");
    });
  });

  describe("GET /stories/{storyId} Integration", () => {
    it("should retrieve story with episodes", async () => {
      // Mock getStoryWithEpisodes - first call for story metadata
      mockDocClient.send
        .mockResolvedValueOnce({
          Items: [mockStory],
          Count: 1,
          ScannedCount: 1,
        })
        // Second call for episodes
        .mockResolvedValueOnce({
          Items: [mockEpisode],
          Count: 1,
          ScannedCount: 1,
        });

      const event = createMockEvent(`/stories/${testStoryId}`, {
        storyId: testStoryId,
      });
      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);

      // Verify both DynamoDB calls were made
      expect(mockDocClient.send).toHaveBeenCalledTimes(2);

      // First call: get story by storyId
      expect(mockDocClient.send).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: "test-manga-table",
            IndexName: "GSI1",
            KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
            ExpressionAttributeValues: {
              ":gsi1pk": `STORY#${testStoryId}`,
              ":gsi1sk": "METADATA",
            },
          }),
        })
      );

      // Second call: get episodes for story
      expect(mockDocClient.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: "test-manga-table",
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": `STORY#${testStoryId}`,
              ":sk": "EPISODE#",
            },
            ScanIndexForward: true,
          }),
        })
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.story.storyId).toBe(testStoryId);
      expect(responseBody.data.episodes).toHaveLength(1);
      expect(responseBody.data.episodes[0].episodeId).toBe(testEpisodeId);
    });

    it("should return 404 for non-existent story", async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        ScannedCount: 0,
      });

      const event = createMockEvent(`/stories/${testStoryId}`, {
        storyId: testStoryId,
      });
      const result = await handler(event as any);

      expect(result.statusCode).toBe(404);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("STORY_NOT_FOUND");
    });

    it("should enforce user ownership", async () => {
      const otherUserStory = {
        ...mockStory,
        PK: "USER#other-user",
        userId: "other-user",
      };

      mockDocClient.send.mockResolvedValueOnce({
        Items: [otherUserStory],
        Count: 1,
        ScannedCount: 1,
      });

      const event = createMockEvent(`/stories/${testStoryId}`, {
        storyId: testStoryId,
      });
      const result = await handler(event as any);

      expect(result.statusCode).toBe(403);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("ACCESS_DENIED");
    });
  });

  describe("GET /episodes/{episodeId} Integration", () => {
    it("should retrieve episode with story context", async () => {
      // Mock getByEpisodeId
      mockDocClient.send
        .mockResolvedValueOnce({
          Items: [mockEpisode],
          Count: 1,
          ScannedCount: 1,
        })
        // Mock getByStoryId for ownership verification
        .mockResolvedValueOnce({
          Items: [mockStory],
          Count: 1,
          ScannedCount: 1,
        });

      const event = createMockEvent(`/episodes/${testEpisodeId}`, {
        episodeId: testEpisodeId,
      });
      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);

      // Verify both DynamoDB calls were made
      expect(mockDocClient.send).toHaveBeenCalledTimes(2);

      // First call: get episode by episodeId
      expect(mockDocClient.send).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: "test-manga-table",
            IndexName: "GSI1",
            KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
            ExpressionAttributeValues: {
              ":gsi1pk": `EPISODE#${testEpisodeId}`,
              ":gsi1sk": "METADATA",
            },
          }),
        })
      );

      // Second call: get story for ownership verification
      expect(mockDocClient.send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: "test-manga-table",
            IndexName: "GSI1",
            KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
            ExpressionAttributeValues: {
              ":gsi1pk": `STORY#${testStoryId}`,
              ":gsi1sk": "METADATA",
            },
          }),
        })
      );

      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.episode.episodeId).toBe(testEpisodeId);
      expect(responseBody.data.story.storyId).toBe(testStoryId);
    });

    it("should return 404 for non-existent episode", async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        ScannedCount: 0,
      });

      const event = createMockEvent(`/episodes/${testEpisodeId}`, {
        episodeId: testEpisodeId,
      });
      const result = await handler(event as any);

      expect(result.statusCode).toBe(404);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("EPISODE_NOT_FOUND");
    });

    it("should enforce user ownership through story", async () => {
      const otherUserStory = {
        ...mockStory,
        PK: "USER#other-user",
        userId: "other-user",
      };

      mockDocClient.send
        .mockResolvedValueOnce({
          Items: [mockEpisode],
          Count: 1,
          ScannedCount: 1,
        })
        .mockResolvedValueOnce({
          Items: [otherUserStory],
          Count: 1,
          ScannedCount: 1,
        });

      const event = createMockEvent(`/episodes/${testEpisodeId}`, {
        episodeId: testEpisodeId,
      });
      const result = await handler(event as any);

      expect(result.statusCode).toBe(403);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("ACCESS_DENIED");
    });
  });

  describe("Authentication and Authorization", () => {
    it("should include proper CORS headers", async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        ScannedCount: 0,
      });

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      expect(result.headers).toEqual({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
      });
    });

    it("should extract user ID from JWT claims", async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: [mockStory],
        Count: 1,
        ScannedCount: 1,
      });

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      expect(mockDocClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ExpressionAttributeValues: expect.objectContaining({
              ":pk": `USER#${testUserId}`,
            }),
          }),
        })
      );
    });

    it("should include request tracking in responses", async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        ScannedCount: 0,
      });

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      const responseBody = JSON.parse(result.body);
      expect(responseBody.requestId).toBe(testRequestId);
      expect(responseBody.timestamp).toBe(testTimestamp);
    });
  });

  describe("Error Handling and Resilience", () => {
    it("should handle malformed path parameters", async () => {
      const event = createMockEvent("/stories/", null);
      const result = await handler(event as any);

      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("INVALID_PATH");
    });

    it("should handle DynamoDB throttling", async () => {
      const throttlingError = new Error("Request rate exceeded");
      throttlingError.name = "ProvisionedThroughputExceededException";
      mockDocClient.send.mockRejectedValueOnce(throttlingError);

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("FETCH_ERROR");
    });

    it("should handle network timeouts", async () => {
      const timeoutError = new Error("Network timeout");
      timeoutError.name = "TimeoutError";
      mockDocClient.send.mockRejectedValueOnce(timeoutError);

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error.code).toBe("FETCH_ERROR");
    });
  });

  describe("Performance and Scalability", () => {
    it("should respect limit parameters to prevent large responses", async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: Array(100).fill(mockStory),
        Count: 100,
        ScannedCount: 100,
      });

      const event = createMockEvent("/stories", null, { limit: "150" });
      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      // Should cap at 100 even though 150 was requested
      expect(mockDocClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Limit: 100,
          }),
        })
      );
    });

    it("should handle large datasets efficiently", async () => {
      const largeStoryList = Array(50)
        .fill(null)
        .map((_, index) => ({
          ...mockStory,
          storyId: `story-${index}`,
          SK: `STORY#story-${index}`,
          title: `Story ${index}`,
        }));

      mockDocClient.send.mockResolvedValueOnce({
        Items: largeStoryList,
        Count: 50,
        ScannedCount: 50,
      });

      const event = createMockEvent("/stories");
      const result = await handler(event as any);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.data.stories).toHaveLength(50);
      expect(responseBody.data.count).toBe(50);
    });
  });
});
