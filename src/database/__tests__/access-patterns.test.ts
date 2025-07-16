import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  UserProfileAccess,
  UserPreferencesAccess,
  StoryAccess,
  EpisodeAccess,
  GenerationRequestAccess,
  BatchOperations,
} from "../access-patterns";
import {
  UserProfile,
  Story,
  Episode,
  GenerationRequest,
} from "../../types/data-models";

// Mock the DynamoDB Document Client
const ddbMock = mockClient(DynamoDBDocumentClient);

describe("DynamoDB Access Patterns", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe("UserProfileAccess", () => {
    it("should create a user profile with correct keys", async () => {
      ddbMock.on(PutCommand).resolves({});

      const userProfile = {
        email: "test@example.com",
        status: "ACTIVE" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      await UserProfileAccess.create(userProfile);

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input).toMatchObject({
        Item: {
          PK: "USER#test@example.com",
          SK: "PROFILE",
          GSI1PK: "USER#test@example.com",
          GSI1SK: "PROFILE",
          email: "test@example.com",
          status: "ACTIVE",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
        ConditionExpression: "attribute_not_exists(PK)",
      });
    });

    it("should get a user profile by userId", async () => {
      const mockProfile: UserProfile = {
        PK: "USER#test-user-id",
        SK: "PROFILE",
        GSI1PK: "USER#test-user-id",
        GSI1SK: "PROFILE",
        email: "test@example.com",
        status: "ACTIVE",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      ddbMock.on(GetCommand).resolves({ Item: mockProfile });

      const result = await UserProfileAccess.get("test-user-id");

      expect(result).toEqual(mockProfile);
      expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
      const getCall = ddbMock.commandCalls(GetCommand)[0];
      expect(getCall.args[0].input).toMatchObject({
        Key: {
          PK: "USER#test-user-id",
          SK: "PROFILE",
        },
      });
    });

    it("should update a user profile", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await UserProfileAccess.update("test-user-id", { status: "INACTIVE" });

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
      const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input).toMatchObject({
        Key: {
          PK: "USER#test-user-id",
          SK: "PROFILE",
        },
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: expect.objectContaining({
          ":status": "INACTIVE",
          ":updatedAt": expect.any(String),
        }),
      });
    });
  });

  describe("StoryAccess", () => {
    it("should create a story with correct keys", async () => {
      ddbMock.on(PutCommand).resolves({});

      const story = {
        storyId: "story-123",
        userId: "user-123",
        title: "Test Story",
        s3Key: "stories/user-123/story-123/story.md",
        status: "PENDING" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      await StoryAccess.create(story);

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input).toMatchObject({
        Item: {
          PK: "USER#user-123",
          SK: "STORY#story-123",
          GSI1PK: "STORY#story-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#PENDING",
          GSI2SK: "2024-01-01T00:00:00.000Z",
          storyId: "story-123",
          userId: "user-123",
          title: "Test Story",
          s3Key: "stories/user-123/story-123/story.md",
          status: "PENDING",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      });
    });

    it("should get stories by status", async () => {
      const mockStories = [
        {
          PK: "USER#user-123",
          SK: "STORY#story-123",
          GSI1PK: "STORY#story-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#PENDING",
          GSI2SK: "2024-01-01T00:00:00.000Z",
          storyId: "story-123",
          userId: "user-123",
          title: "Test Story",
          s3Key: "stories/user-123/story-123/story.md",
          status: "PENDING",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockStories });

      const result = await StoryAccess.getStoriesByStatus("PENDING");

      expect(result).toEqual(mockStories);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input).toMatchObject({
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :gsi2pk",
        ExpressionAttributeValues: {
          ":gsi2pk": "STATUS#PENDING",
        },
        ScanIndexForward: false,
        Limit: 50,
      });
    });

    it("should update story status", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await StoryAccess.updateStatus("user-123", "story-123", "COMPLETED", {
        s3Key: "new-key",
      });

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
      const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input).toMatchObject({
        Key: {
          PK: "USER#user-123",
          SK: "STORY#story-123",
        },
        UpdateExpression:
          "SET #status = :status, updatedAt = :updatedAt, GSI2PK = :gsi2pk, #s3Key = :s3Key",
        ExpressionAttributeNames: {
          "#status": "status",
          "#s3Key": "s3Key",
        },
        ExpressionAttributeValues: expect.objectContaining({
          ":status": "COMPLETED",
          ":gsi2pk": "STATUS#COMPLETED",
          ":s3Key": "new-key",
          ":updatedAt": expect.any(String),
        }),
      });
    });
  });

  describe("EpisodeAccess", () => {
    it("should create an episode with correct keys", async () => {
      ddbMock.on(PutCommand).resolves({});

      const episode = {
        episodeId: "episode-123",
        episodeNumber: 1,
        storyId: "story-123",
        s3Key: "episodes/user-123/story-123/1/episode.md",
        status: "PENDING" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      await EpisodeAccess.create(episode);

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input).toMatchObject({
        Item: {
          PK: "STORY#story-123",
          SK: "EPISODE#001",
          GSI1PK: "EPISODE#episode-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#PENDING",
          GSI2SK: "2024-01-01T00:00:00.000Z",
          episodeId: "episode-123",
          episodeNumber: 1,
          storyId: "story-123",
          s3Key: "episodes/user-123/story-123/1/episode.md",
          status: "PENDING",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      });
    });

    it("should get story episodes in order", async () => {
      const mockEpisodes = [
        {
          PK: "STORY#story-123",
          SK: "EPISODE#001",
          episodeNumber: 1,
        },
        {
          PK: "STORY#story-123",
          SK: "EPISODE#002",
          episodeNumber: 2,
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockEpisodes });

      const result = await EpisodeAccess.getStoryEpisodes("story-123");

      expect(result).toEqual(mockEpisodes);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input).toMatchObject({
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "STORY#story-123",
          ":sk": "EPISODE#",
        },
        ScanIndexForward: true, // Episodes in order
      });
    });
  });

  describe("BatchOperations", () => {
    it("should get story with episodes", async () => {
      const mockStory: Story = {
        PK: "USER#user-123",
        SK: "STORY#story-123",
        GSI1PK: "STORY#story-123",
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#COMPLETED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        storyId: "story-123",
        userId: "user-123",
        title: "Test Story",
        s3Key: "stories/user-123/story-123/story.md",
        status: "COMPLETED",
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockEpisodes: Episode[] = [
        {
          PK: "STORY#story-123",
          SK: "EPISODE#001",
          GSI1PK: "EPISODE#episode-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#COMPLETED",
          GSI2SK: "2024-01-01T00:00:00.000Z",
          episodeId: "episode-123",
          episodeNumber: 1,
          storyId: "story-123",
          s3Key: "episodes/user-123/story-123/1/episode.md",
          status: "COMPLETED",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      // Mock the first query for story
      ddbMock
        .on(QueryCommand, {
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
        })
        .resolvesOnce({ Items: [mockStory] });

      // Mock the second query for episodes
      ddbMock
        .on(QueryCommand, {
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        })
        .resolvesOnce({ Items: mockEpisodes });

      const result = await BatchOperations.getStoryWithEpisodes("story-123");

      expect(result).toEqual({
        story: mockStory,
        episodes: mockEpisodes,
      });
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
    });
  });
});
