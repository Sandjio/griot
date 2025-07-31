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
  BatchWorkflowAccess,
  EpisodeContinuationAccess,
  BatchUserPreferencesAccess,
} from "../access-patterns";
import {
  UserProfile,
  Story,
  Episode,
  GenerationRequest,
  BatchWorkflow,
  EpisodeContinuation,
  UserPreferences,
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

  describe("UserPreferencesAccess", () => {
    it("should create user preferences with correct keys", async () => {
      ddbMock.on(PutCommand).resolves({});

      const preferences = {
        preferences: {
          genres: ["action", "adventure"],
          themes: ["friendship", "courage"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        insights: {
          recommendations: [
            {
              category: "genre",
              score: 0.9,
              attributes: { popularity: "high" },
            },
          ],
          trends: [
            {
              topic: "action",
              popularity: 0.8,
            },
          ],
        },
      };

      await UserPreferencesAccess.create("user-123", preferences);

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input).toMatchObject({
        Item: expect.objectContaining({
          PK: "USER#user-123",
          SK: expect.stringMatching(
            /^PREFERENCES#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
          ),
          GSI1PK: "USER#user-123",
          GSI1SK: expect.stringMatching(
            /^PREFERENCES#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
          ),
          preferences: preferences.preferences,
          insights: preferences.insights,
          createdAt: expect.any(String),
        }),
      });
    });

    it("should get latest user preferences", async () => {
      const mockPreferences = {
        PK: "USER#user-123",
        SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
        GSI1PK: "USER#user-123",
        GSI1SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
        preferences: {
          genres: ["action", "adventure"],
          themes: ["friendship", "courage"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        insights: {
          recommendations: [
            {
              category: "genre",
              score: 0.9,
              attributes: { popularity: "high" },
            },
          ],
          trends: [
            {
              topic: "action",
              popularity: 0.8,
            },
          ],
        },
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      ddbMock.on(QueryCommand).resolves({ Items: [mockPreferences] });

      const result = await UserPreferencesAccess.getLatest("user-123");

      expect(result).toEqual(mockPreferences);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input).toMatchObject({
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "USER#user-123",
          ":sk": "PREFERENCES#",
        },
        ScanIndexForward: false,
        Limit: 1,
      });
    });

    it("should get latest user preferences with metadata", async () => {
      const mockPreferences = {
        PK: "USER#user-123",
        SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
        GSI1PK: "USER#user-123",
        GSI1SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
        preferences: {
          genres: ["action", "adventure"],
          themes: ["friendship", "courage"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        insights: {
          recommendations: [
            {
              category: "genre",
              score: 0.9,
              attributes: { popularity: "high" },
            },
          ],
          trends: [
            {
              topic: "action",
              popularity: 0.8,
            },
          ],
        },
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      ddbMock.on(QueryCommand).resolves({ Items: [mockPreferences] });

      const result = await UserPreferencesAccess.getLatestWithMetadata(
        "user-123"
      );

      expect(result).toEqual({
        preferences: mockPreferences.preferences,
        insights: mockPreferences.insights,
        lastUpdated: mockPreferences.createdAt,
      });
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input).toMatchObject({
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "USER#user-123",
          ":sk": "PREFERENCES#",
        },
        ScanIndexForward: false,
        Limit: 1,
      });
    });

    it("should return null preferences when user has no stored preferences", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await UserPreferencesAccess.getLatestWithMetadata(
        "user-123"
      );

      expect(result).toEqual({
        preferences: null,
      });
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
    });

    it("should handle database errors in getLatestWithMetadata", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      ddbMock.on(QueryCommand).rejects(new Error("Database connection failed"));

      await expect(
        UserPreferencesAccess.getLatestWithMetadata("user-123")
      ).rejects.toThrow("Failed to retrieve user preferences");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error retrieving user preferences with metadata:",
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });

    it("should get user preferences history", async () => {
      const mockPreferencesHistory = [
        {
          PK: "USER#user-123",
          SK: "PREFERENCES#2024-01-02T00:00:00.000Z",
          preferences: { genres: ["action"] },
          createdAt: "2024-01-02T00:00:00.000Z",
        },
        {
          PK: "USER#user-123",
          SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
          preferences: { genres: ["comedy"] },
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockPreferencesHistory });

      const result = await UserPreferencesAccess.getHistory("user-123", 5);

      expect(result).toEqual(mockPreferencesHistory);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input).toMatchObject({
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "USER#user-123",
          ":sk": "PREFERENCES#",
        },
        ScanIndexForward: false,
        Limit: 5,
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

  describe("BatchWorkflowAccess", () => {
    it("should create a batch workflow with correct keys", async () => {
      ddbMock.on(PutCommand).resolves({});

      const workflow = {
        workflowId: "workflow-123",
        userId: "user-123",
        requestId: "request-123",
        numberOfStories: 5,
        completedStories: 0,
        failedStories: 0,
        status: "STARTED" as const,
        preferences: {
          genres: ["action", "adventure"],
          themes: ["friendship", "courage"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      await BatchWorkflowAccess.create(workflow);

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input).toMatchObject({
        Item: {
          PK: "USER#user-123",
          SK: "WORKFLOW#workflow-123",
          GSI1PK: "WORKFLOW#workflow-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#STARTED",
          GSI2SK: "2024-01-01T00:00:00.000Z",
          workflowId: "workflow-123",
          userId: "user-123",
          requestId: "request-123",
          numberOfStories: 5,
          completedStories: 0,
          failedStories: 0,
          status: "STARTED",
          preferences: workflow.preferences,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      });
    });

    it("should get workflow by workflow ID", async () => {
      const mockWorkflow: BatchWorkflow = {
        PK: "USER#user-123",
        SK: "WORKFLOW#workflow-123",
        GSI1PK: "WORKFLOW#workflow-123",
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#IN_PROGRESS",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        workflowId: "workflow-123",
        userId: "user-123",
        requestId: "request-123",
        numberOfStories: 5,
        completedStories: 2,
        failedStories: 0,
        status: "IN_PROGRESS",
        preferences: {
          genres: ["action"],
          themes: ["friendship"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      ddbMock.on(QueryCommand).resolves({ Items: [mockWorkflow] });

      const result = await BatchWorkflowAccess.getByWorkflowId("workflow-123");

      expect(result).toEqual(mockWorkflow);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input).toMatchObject({
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
        ExpressionAttributeValues: {
          ":gsi1pk": "WORKFLOW#workflow-123",
          ":gsi1sk": "METADATA",
        },
      });
    });

    it("should update workflow progress", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await BatchWorkflowAccess.updateProgress(
        "user-123",
        "workflow-123",
        3,
        1,
        "IN_PROGRESS",
        { estimatedCompletionTime: "2024-01-01T01:00:00.000Z" }
      );

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
      const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input).toMatchObject({
        Key: {
          PK: "USER#user-123",
          SK: "WORKFLOW#workflow-123",
        },
        UpdateExpression:
          "SET completedStories = :completedStories, failedStories = :failedStories, updatedAt = :updatedAt, #status = :status, GSI2PK = :gsi2pk, #estimatedCompletionTime = :estimatedCompletionTime",
        ExpressionAttributeNames: {
          "#status": "status",
          "#estimatedCompletionTime": "estimatedCompletionTime",
        },
        ExpressionAttributeValues: expect.objectContaining({
          ":completedStories": 3,
          ":failedStories": 1,
          ":status": "IN_PROGRESS",
          ":gsi2pk": "STATUS#IN_PROGRESS",
          ":estimatedCompletionTime": "2024-01-01T01:00:00.000Z",
          ":updatedAt": expect.any(String),
        }),
      });
    });

    it("should get workflows by status", async () => {
      const mockWorkflows = [
        {
          PK: "USER#user-123",
          SK: "WORKFLOW#workflow-123",
          status: "IN_PROGRESS",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockWorkflows });

      const result = await BatchWorkflowAccess.getWorkflowsByStatus("IN_PROGRESS");

      expect(result).toEqual(mockWorkflows);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input).toMatchObject({
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :gsi2pk",
        ExpressionAttributeValues: {
          ":gsi2pk": "STATUS#IN_PROGRESS",
        },
        ScanIndexForward: false,
        Limit: 50,
      });
    });
  });

  describe("EpisodeContinuationAccess", () => {
    it("should create an episode continuation with correct keys", async () => {
      ddbMock.on(PutCommand).resolves({});

      const continuation = {
        continuationId: "continuation-123",
        storyId: "story-123",
        userId: "user-123",
        nextEpisodeNumber: 2,
        originalPreferences: {
          genres: ["action", "adventure"],
          themes: ["friendship", "courage"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        storyS3Key: "stories/user-123/story-123/story.md",
        status: "REQUESTED" as const,
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      await EpisodeContinuationAccess.create(continuation);

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      const putCall = ddbMock.commandCalls(PutCommand)[0];
      expect(putCall.args[0].input).toMatchObject({
        Item: {
          PK: "STORY#story-123",
          SK: "CONTINUATION#continuation-123",
          GSI1PK: "CONTINUATION#continuation-123",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#REQUESTED",
          GSI2SK: "2024-01-01T00:00:00.000Z",
          continuationId: "continuation-123",
          storyId: "story-123",
          userId: "user-123",
          nextEpisodeNumber: 2,
          originalPreferences: continuation.originalPreferences,
          storyS3Key: "stories/user-123/story-123/story.md",
          status: "REQUESTED",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      });
    });

    it("should get next episode number", async () => {
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

      const result = await EpisodeContinuationAccess.getNextEpisodeNumber("story-123");

      expect(result).toBe(3);
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
    });

    it("should return 1 for next episode number when no episodes exist", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await EpisodeContinuationAccess.getNextEpisodeNumber("story-123");

      expect(result).toBe(1);
    });

    it("should update continuation status", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await EpisodeContinuationAccess.updateStatus(
        "story-123",
        "continuation-123",
        "COMPLETED",
        { resultingEpisodeId: "episode-456" }
      );

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
      const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input).toMatchObject({
        Key: {
          PK: "STORY#story-123",
          SK: "CONTINUATION#continuation-123",
        },
        UpdateExpression:
          "SET #status = :status, updatedAt = :updatedAt, GSI2PK = :gsi2pk, #resultingEpisodeId = :resultingEpisodeId",
        ExpressionAttributeNames: {
          "#status": "status",
          "#resultingEpisodeId": "resultingEpisodeId",
        },
        ExpressionAttributeValues: expect.objectContaining({
          ":status": "COMPLETED",
          ":gsi2pk": "STATUS#COMPLETED",
          ":resultingEpisodeId": "episode-456",
          ":updatedAt": expect.any(String),
        }),
      });
    });
  });

  describe("BatchUserPreferencesAccess", () => {
    it("should get preferences for story generation", async () => {
      const mockPreferences: UserPreferences = {
        PK: "USER#user-123",
        SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
        GSI1PK: "USER#user-123",
        GSI1SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
        preferences: {
          genres: ["action", "adventure"],
          themes: ["friendship", "courage"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        insights: {
          recommendations: [
            {
              category: "genre",
              score: 0.9,
              attributes: { popularity: "high" },
            },
          ],
          trends: [
            {
              topic: "action",
              popularity: 0.8,
            },
          ],
        },
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      ddbMock.on(QueryCommand).resolves({ Items: [mockPreferences] });

      const result = await BatchUserPreferencesAccess.getPreferencesForStoryGeneration(
        "user-123"
      );

      expect(result).toEqual({
        preferences: mockPreferences.preferences,
        insights: mockPreferences.insights,
        lastUpdated: mockPreferences.createdAt,
      });
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1);
    });

    it("should return null when no preferences exist for story generation", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await BatchUserPreferencesAccess.getPreferencesForStoryGeneration(
        "user-123"
      );

      expect(result).toBeNull();
    });

    it("should handle errors in getPreferencesForStoryGeneration", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      ddbMock.on(QueryCommand).rejects(new Error("Database error"));

      await expect(
        BatchUserPreferencesAccess.getPreferencesForStoryGeneration("user-123")
      ).rejects.toThrow("Failed to retrieve user preferences for story generation");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error retrieving preferences for story generation:",
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
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

    it("should get workflow progress", async () => {
      const mockWorkflow: BatchWorkflow = {
        PK: "USER#user-123",
        SK: "WORKFLOW#workflow-123",
        GSI1PK: "WORKFLOW#workflow-123",
        GSI1SK: "METADATA",
        GSI2PK: "STATUS#IN_PROGRESS",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        workflowId: "workflow-123",
        userId: "user-123",
        requestId: "request-123",
        numberOfStories: 5,
        completedStories: 2,
        failedStories: 1,
        status: "IN_PROGRESS",
        preferences: {
          genres: ["action"],
          themes: ["friendship"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      const mockStories: Story[] = [
        {
          PK: "USER#user-123",
          SK: "STORY#story-1",
          GSI1PK: "STORY#story-1",
          GSI1SK: "METADATA",
          GSI2PK: "STATUS#COMPLETED",
          GSI2SK: "2024-01-01T00:05:00.000Z",
          storyId: "story-1",
          userId: "user-123",
          title: "Story 1",
          s3Key: "stories/user-123/story-1/story.md",
          status: "COMPLETED",
          createdAt: "2024-01-01T00:05:00.000Z",
        },
      ];

      // Mock workflow query
      ddbMock
        .on(QueryCommand, {
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
        })
        .resolvesOnce({ Items: [mockWorkflow] });

      // Mock user stories query
      ddbMock
        .on(QueryCommand, {
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        })
        .resolvesOnce({ Items: mockStories });

      const result = await BatchOperations.getWorkflowProgress("workflow-123");

      expect(result).toEqual({
        workflow: mockWorkflow,
        stories: mockStories,
        totalProgress: 0.6, // (2 + 1) / 5
      });
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
    });

    it("should get story for continuation with all required data", async () => {
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

      const mockPreferences: UserPreferences = {
        PK: "USER#user-123",
        SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
        GSI1PK: "USER#user-123",
        GSI1SK: "PREFERENCES#2024-01-01T00:00:00.000Z",
        preferences: {
          genres: ["action", "adventure"],
          themes: ["friendship", "courage"],
          artStyle: "manga",
          targetAudience: "teen",
          contentRating: "PG-13",
        },
        createdAt: "2024-01-01T00:00:00.000Z",
      };

      // Mock story query
      ddbMock
        .on(QueryCommand, {
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
        })
        .resolvesOnce({ Items: [mockStory] });

      // Mock episodes query
      ddbMock
        .on(QueryCommand, {
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: {
            ":pk": "STORY#story-123",
            ":sk": "EPISODE#",
          },
        })
        .resolvesOnce({ Items: mockEpisodes })
        .resolvesOnce({ Items: mockEpisodes }); // Called twice for next episode number

      // Mock preferences query
      ddbMock
        .on(QueryCommand, {
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: {
            ":pk": "USER#user-123",
            ":sk": "PREFERENCES#",
          },
        })
        .resolvesOnce({ Items: [mockPreferences] });

      const result = await BatchOperations.getStoryForContinuation("story-123");

      expect(result).toEqual({
        story: mockStory,
        episodes: mockEpisodes,
        nextEpisodeNumber: 2,
        preferences: mockPreferences.preferences,
      });
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(4);
    });
  });
});
