import {
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAME } from "./dynamodb-client";
import {
  UserProfile,
  UserPreferences,
  UserPreferencesData,
  QlooInsights,
  Story,
  Episode,
  GenerationRequest,
  GenerationStatus,
  BatchWorkflow,
  BatchWorkflowStatus,
  EpisodeContinuation,
  EpisodeContinuationStatus,
} from "../types/data-models";

/**
 * DynamoDB Single Table Design Access Patterns
 *
 * Entity Patterns:
 * - User Profile: PK=USER#{userId}, SK=PROFILE
 * - User Preferences: PK=USER#{userId}, SK=PREFERENCES#{timestamp}
 * - Story: PK=USER#{userId}, SK=STORY#{storyId}
 * - Episode: PK=STORY#{storyId}, SK=EPISODE#{episodeNumber}
 * - Generation Request: PK=USER#{userId}, SK=REQUEST#{requestId}
 */

// User Profile Operations
export class UserProfileAccess {
  static async create(
    userProfile: Omit<UserProfile, "PK" | "SK" | "GSI1PK" | "GSI1SK">
  ): Promise<void> {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${userProfile.email}` as const,
        SK: "PROFILE" as const,
        GSI1PK: `USER#${userProfile.email}` as const,
        GSI1SK: "PROFILE" as const,
        ...userProfile,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    });

    await docClient.send(command);
  }

  static async get(userId: string): Promise<UserProfile | null> {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: "PROFILE",
      },
    });

    const result = await docClient.send(command);
    return (result.Item as UserProfile) || null;
  }

  static async update(
    userId: string,
    updates: Partial<Omit<UserProfile, "PK" | "SK" | "GSI1PK" | "GSI1SK">>
  ): Promise<void> {
    const updateExpression = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (key !== "userId") {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    }

    if (updateExpression.length === 0) return;

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: "PROFILE",
      },
      UpdateExpression: `SET ${updateExpression.join(
        ", "
      )}, updatedAt = :updatedAt`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: {
        ...expressionAttributeValues,
        ":updatedAt": new Date().toISOString(),
      },
    });

    await docClient.send(command);
  }
}

// User Preferences Operations
export class UserPreferencesAccess {
  static async create(
    userId: string,
    preferences: Omit<
      UserPreferences,
      "PK" | "SK" | "GSI1PK" | "GSI1SK" | "createdAt"
    >
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${userId}` as const,
        SK: `PREFERENCES#${timestamp}` as const,
        GSI1PK: `USER#${userId}` as const,
        GSI1SK: `PREFERENCES#${timestamp}` as const,
        ...preferences,
        createdAt: timestamp,
      },
    });

    await docClient.send(command);
  }

  static async getLatest(userId: string): Promise<UserPreferences | null> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":sk": "PREFERENCES#",
      },
      ScanIndexForward: false,
      Limit: 1,
    });

    const result = await docClient.send(command);
    return (result.Items?.[0] as UserPreferences) || null;
  }

  static async getLatestWithMetadata(userId: string): Promise<{
    preferences: UserPreferencesData | null;
    insights?: QlooInsights;
    lastUpdated?: string;
  }> {
    try {
      const command = new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":sk": "PREFERENCES#",
        },
        ScanIndexForward: false,
        Limit: 1,
      });

      const result = await docClient.send(command);
      const latestPreference = result.Items?.[0] as UserPreferences;

      if (!latestPreference) {
        return {
          preferences: null,
        };
      }

      return {
        preferences: latestPreference.preferences,
        insights: latestPreference.insights,
        lastUpdated: latestPreference.createdAt,
      };
    } catch (error) {
      console.error("Error retrieving user preferences with metadata:", error);
      throw new Error("Failed to retrieve user preferences");
    }
  }

  static async getHistory(
    userId: string,
    limit = 10
  ): Promise<UserPreferences[]> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":sk": "PREFERENCES#",
      },
      ScanIndexForward: false,
      Limit: limit,
    });

    const result = await docClient.send(command);
    return (result.Items as UserPreferences[]) || [];
  }
}

// Story Operations
export class StoryAccess {
  static async create(
    story: Omit<Story, "PK" | "SK" | "GSI1PK" | "GSI1SK" | "GSI2PK" | "GSI2SK">
  ): Promise<void> {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${story.userId}` as const,
        SK: `STORY#${story.storyId}` as const,
        GSI1PK: `STORY#${story.storyId}` as const,
        GSI1SK: "METADATA" as const,
        GSI2PK: `STATUS#${story.status}` as const,
        GSI2SK: story.createdAt,
        ...story,
      },
    });

    await docClient.send(command);
  }

  static async get(userId: string, storyId: string): Promise<Story | null> {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `STORY#${storyId}`,
      },
    });

    const result = await docClient.send(command);
    return (result.Item as Story) || null;
  }

  static async getByStoryId(storyId: string): Promise<Story | null> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
      ExpressionAttributeValues: {
        ":gsi1pk": `STORY#${storyId}`,
        ":gsi1sk": "METADATA",
      },
    });

    const result = await docClient.send(command);
    return (result.Items?.[0] as Story) || null;
  }

  static async getUserStories(userId: string, limit = 20): Promise<Story[]> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":sk": "STORY#",
      },
      ScanIndexForward: false,
      Limit: limit,
    });

    const result = await docClient.send(command);
    return (result.Items as Story[]) || [];
  }

  static async getStoriesByStatus(
    status: GenerationStatus,
    limit = 50
  ): Promise<Story[]> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :gsi2pk",
      ExpressionAttributeValues: {
        ":gsi2pk": `STATUS#${status}`,
      },
      ScanIndexForward: false,
      Limit: limit,
    });

    const result = await docClient.send(command);
    return (result.Items as Story[]) || [];
  }

  static async updateStatus(
    userId: string,
    storyId: string,
    status: GenerationStatus,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    const updateExpression = [
      "#status = :status",
      "updatedAt = :updatedAt",
      "GSI2PK = :gsi2pk",
    ];
    const expressionAttributeNames: Record<string, string> = {
      "#status": "status",
    };
    const expressionAttributeValues: Record<string, any> = {
      ":status": status,
      ":updatedAt": new Date().toISOString(),
      ":gsi2pk": `STATUS#${status}`,
    };

    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    }

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `STORY#${storyId}`,
      },
      UpdateExpression: `SET ${updateExpression.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await docClient.send(command);
  }
}

// Episode Operations
export class EpisodeAccess {
  static async create(
    episode: Omit<
      Episode,
      "PK" | "SK" | "GSI1PK" | "GSI1SK" | "GSI2PK" | "GSI2SK"
    >
  ): Promise<void> {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `STORY#${episode.storyId}` as const,
        SK: `EPISODE#${episode.episodeNumber
          .toString()
          .padStart(3, "0")}` as const,
        GSI1PK: `EPISODE#${episode.episodeId}` as const,
        GSI1SK: "METADATA" as const,
        GSI2PK: `STATUS#${episode.status}` as const,
        GSI2SK: episode.createdAt,
        ...episode,
      },
    });

    await docClient.send(command);
  }

  static async get(
    storyId: string,
    episodeNumber: number
  ): Promise<Episode | null> {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `STORY#${storyId}`,
        SK: `EPISODE#${episodeNumber.toString().padStart(3, "0")}`,
      },
    });

    const result = await docClient.send(command);
    return (result.Item as Episode) || null;
  }

  static async getByEpisodeId(episodeId: string): Promise<Episode | null> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
      ExpressionAttributeValues: {
        ":gsi1pk": `EPISODE#${episodeId}`,
        ":gsi1sk": "METADATA",
      },
    });

    const result = await docClient.send(command);
    return (result.Items?.[0] as Episode) || null;
  }

  static async getStoryEpisodes(storyId: string): Promise<Episode[]> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `STORY#${storyId}`,
        ":sk": "EPISODE#",
      },
      ScanIndexForward: true, // Episodes in order
    });

    const result = await docClient.send(command);
    return (result.Items as Episode[]) || [];
  }

  static async updateStatus(
    storyId: string,
    episodeNumber: number,
    status: GenerationStatus,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    const updateExpression = [
      "#status = :status",
      "updatedAt = :updatedAt",
      "GSI2PK = :gsi2pk",
    ];
    const expressionAttributeNames: Record<string, string> = {
      "#status": "status",
    };
    const expressionAttributeValues: Record<string, any> = {
      ":status": status,
      ":updatedAt": new Date().toISOString(),
      ":gsi2pk": `STATUS#${status}`,
    };

    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    }

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `STORY#${storyId}`,
        SK: `EPISODE#${episodeNumber.toString().padStart(3, "0")}`,
      },
      UpdateExpression: `SET ${updateExpression.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await docClient.send(command);
  }
}

// Generation Request Operations
export class GenerationRequestAccess {
  static async create(
    request: Omit<
      GenerationRequest,
      "PK" | "SK" | "GSI1PK" | "GSI1SK" | "GSI2PK" | "GSI2SK"
    >
  ): Promise<void> {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${request.userId}` as const,
        SK: `REQUEST#${request.requestId}` as const,
        GSI1PK: `REQUEST#${request.requestId}` as const,
        GSI1SK: "STATUS" as const,
        GSI2PK: `STATUS#${request.status}` as const,
        GSI2SK: request.createdAt,
        ...request,
      },
    });

    await docClient.send(command);
  }

  static async get(
    userId: string,
    requestId: string
  ): Promise<GenerationRequest | null> {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `REQUEST#${requestId}`,
      },
    });

    const result = await docClient.send(command);
    return (result.Item as GenerationRequest) || null;
  }

  static async getByRequestId(
    requestId: string
  ): Promise<GenerationRequest | null> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
      ExpressionAttributeValues: {
        ":gsi1pk": `REQUEST#${requestId}`,
        ":gsi1sk": "STATUS",
      },
    });

    const result = await docClient.send(command);
    return (result.Items?.[0] as GenerationRequest) || null;
  }

  static async getUserRequests(
    userId: string,
    limit = 20
  ): Promise<GenerationRequest[]> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":sk": "REQUEST#",
      },
      ScanIndexForward: false,
      Limit: limit,
    });

    const result = await docClient.send(command);
    return (result.Items as GenerationRequest[]) || [];
  }

  static async updateStatus(
    userId: string,
    requestId: string,
    status: GenerationStatus,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    const updateExpression = [
      "#status = :status",
      "updatedAt = :updatedAt",
      "GSI2PK = :gsi2pk",
    ];
    const expressionAttributeNames: Record<string, string> = {
      "#status": "status",
    };
    const expressionAttributeValues: Record<string, any> = {
      ":status": status,
      ":updatedAt": new Date().toISOString(),
      ":gsi2pk": `STATUS#${status}`,
    };

    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    }

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `REQUEST#${requestId}`,
      },
      UpdateExpression: `SET ${updateExpression.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await docClient.send(command);
  }
}

// Batch Workflow Operations
export class BatchWorkflowAccess {
  static async create(
    workflow: Omit<BatchWorkflow, "PK" | "SK" | "GSI1PK" | "GSI1SK" | "GSI2PK" | "GSI2SK">
  ): Promise<void> {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${workflow.userId}` as const,
        SK: `WORKFLOW#${workflow.workflowId}` as const,
        GSI1PK: `WORKFLOW#${workflow.workflowId}` as const,
        GSI1SK: "METADATA" as const,
        GSI2PK: `STATUS#${workflow.status}` as const,
        GSI2SK: workflow.createdAt,
        ...workflow,
      },
    });

    await docClient.send(command);
  }

  static async get(userId: string, workflowId: string): Promise<BatchWorkflow | null> {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
    });

    const result = await docClient.send(command);
    return (result.Item as BatchWorkflow) || null;
  }

  static async getByWorkflowId(workflowId: string): Promise<BatchWorkflow | null> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
      ExpressionAttributeValues: {
        ":gsi1pk": `WORKFLOW#${workflowId}`,
        ":gsi1sk": "METADATA",
      },
    });

    const result = await docClient.send(command);
    return (result.Items?.[0] as BatchWorkflow) || null;
  }

  static async updateProgress(
    userId: string,
    workflowId: string,
    completedStories: number,
    failedStories: number,
    status?: BatchWorkflowStatus,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    const updateExpression = [
      "completedStories = :completedStories",
      "failedStories = :failedStories",
      "updatedAt = :updatedAt",
    ];
    const expressionAttributeValues: Record<string, any> = {
      ":completedStories": completedStories,
      ":failedStories": failedStories,
      ":updatedAt": new Date().toISOString(),
    };
    const expressionAttributeNames: Record<string, string> = {};

    if (status) {
      updateExpression.push("#status = :status", "GSI2PK = :gsi2pk");
      expressionAttributeNames["#status"] = "status";
      expressionAttributeValues[":status"] = status;
      expressionAttributeValues[":gsi2pk"] = `STATUS#${status}`;
    }

    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    }

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `USER#${userId}`,
        SK: `WORKFLOW#${workflowId}`,
      },
      UpdateExpression: `SET ${updateExpression.join(", ")}`,
      ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await docClient.send(command);
  }

  static async getUserWorkflows(userId: string, limit = 20): Promise<BatchWorkflow[]> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":sk": "WORKFLOW#",
      },
      ScanIndexForward: false,
      Limit: limit,
    });

    const result = await docClient.send(command);
    return (result.Items as BatchWorkflow[]) || [];
  }

  static async getWorkflowsByStatus(
    status: BatchWorkflowStatus,
    limit = 50
  ): Promise<BatchWorkflow[]> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :gsi2pk",
      ExpressionAttributeValues: {
        ":gsi2pk": `STATUS#${status}`,
      },
      ScanIndexForward: false,
      Limit: limit,
    });

    const result = await docClient.send(command);
    return (result.Items as BatchWorkflow[]) || [];
  }
}

// Episode Continuation Operations
export class EpisodeContinuationAccess {
  static async create(
    continuation: Omit<EpisodeContinuation, "PK" | "SK" | "GSI1PK" | "GSI1SK" | "GSI2PK" | "GSI2SK">
  ): Promise<void> {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `STORY#${continuation.storyId}` as const,
        SK: `CONTINUATION#${continuation.continuationId}` as const,
        GSI1PK: `CONTINUATION#${continuation.continuationId}` as const,
        GSI1SK: "METADATA" as const,
        GSI2PK: `STATUS#${continuation.status}` as const,
        GSI2SK: continuation.createdAt,
        ...continuation,
      },
    });

    await docClient.send(command);
  }

  static async get(
    storyId: string,
    continuationId: string
  ): Promise<EpisodeContinuation | null> {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `STORY#${storyId}`,
        SK: `CONTINUATION#${continuationId}`,
      },
    });

    const result = await docClient.send(command);
    return (result.Item as EpisodeContinuation) || null;
  }

  static async getByContinuationId(
    continuationId: string
  ): Promise<EpisodeContinuation | null> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
      ExpressionAttributeValues: {
        ":gsi1pk": `CONTINUATION#${continuationId}`,
        ":gsi1sk": "METADATA",
      },
    });

    const result = await docClient.send(command);
    return (result.Items?.[0] as EpisodeContinuation) || null;
  }

  static async getStoryContinuations(storyId: string): Promise<EpisodeContinuation[]> {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `STORY#${storyId}`,
        ":sk": "CONTINUATION#",
      },
      ScanIndexForward: false,
    });

    const result = await docClient.send(command);
    return (result.Items as EpisodeContinuation[]) || [];
  }

  static async updateStatus(
    storyId: string,
    continuationId: string,
    status: EpisodeContinuationStatus,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    const updateExpression = [
      "#status = :status",
      "updatedAt = :updatedAt",
      "GSI2PK = :gsi2pk",
    ];
    const expressionAttributeNames: Record<string, string> = {
      "#status": "status",
    };
    const expressionAttributeValues: Record<string, any> = {
      ":status": status,
      ":updatedAt": new Date().toISOString(),
      ":gsi2pk": `STATUS#${status}`,
    };

    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        updateExpression.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    }

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `STORY#${storyId}`,
        SK: `CONTINUATION#${continuationId}`,
      },
      UpdateExpression: `SET ${updateExpression.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await docClient.send(command);
  }

  static async getNextEpisodeNumber(storyId: string): Promise<number> {
    const episodes = await EpisodeAccess.getStoryEpisodes(storyId);
    if (episodes.length === 0) {
      return 1;
    }
    const maxEpisodeNumber = Math.max(...episodes.map(ep => ep.episodeNumber));
    return maxEpisodeNumber + 1;
  }
}

// Enhanced User Preferences Access for Batch Workflows
export class BatchUserPreferencesAccess extends UserPreferencesAccess {
  static async getPreferencesForStoryGeneration(
    userId: string
  ): Promise<{
    preferences: UserPreferencesData;
    insights?: QlooInsights;
    lastUpdated: string;
  } | null> {
    try {
      const result = await this.getLatestWithMetadata(userId);
      
      if (!result.preferences) {
        return null;
      }

      return {
        preferences: result.preferences,
        insights: result.insights,
        lastUpdated: result.lastUpdated || new Date().toISOString(),
      };
    } catch (error) {
      console.error("Error retrieving preferences for story generation:", error);
      throw new Error("Failed to retrieve user preferences for story generation");
    }
  }

  static async batchGetUserPreferences(
    userIds: string[]
  ): Promise<Record<string, { preferences: UserPreferencesData; insights?: QlooInsights }>> {
    if (userIds.length === 0) return {};

    const keys = userIds.map(userId => ({
      PK: `USER#${userId}`,
      SK: "PREFERENCES#", // This will need to be handled differently for latest
    }));

    // For batch operations, we'll need to query each user individually for latest preferences
    const results: Record<string, { preferences: UserPreferencesData; insights?: QlooInsights }> = {};
    
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const latest = await this.getLatest(userId);
          if (latest) {
            results[userId] = {
              preferences: latest.preferences,
              insights: latest.insights,
            };
          }
        } catch (error) {
          console.error(`Error fetching preferences for user ${userId}:`, error);
        }
      })
    );

    return results;
  }
}

// Batch Operations for efficiency
export class BatchOperations {
  static async batchGetItems(
    keys: Array<{ PK: string; SK: string }>
  ): Promise<any[]> {
    if (keys.length === 0) return [];

    const command = new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: keys,
        },
      },
    });

    const result = await docClient.send(command);
    return result.Responses?.[TABLE_NAME] || [];
  }

  static async getStoryWithEpisodes(
    storyId: string
  ): Promise<{ story: Story | null; episodes: Episode[] }> {
    // First get the story metadata
    const story = await StoryAccess.getByStoryId(storyId);
    if (!story) {
      return { story: null, episodes: [] };
    }

    // Then get all episodes for this story
    const episodes = await EpisodeAccess.getStoryEpisodes(storyId);

    return { story, episodes };
  }

  static async getWorkflowProgress(
    workflowId: string
  ): Promise<{
    workflow: BatchWorkflow | null;
    stories: Story[];
    totalProgress: number;
  }> {
    const workflow = await BatchWorkflowAccess.getByWorkflowId(workflowId);
    if (!workflow) {
      return { workflow: null, stories: [], totalProgress: 0 };
    }

    const stories = await StoryAccess.getUserStories(workflow.userId);
    const workflowStories = stories.filter(story => 
      story.createdAt >= workflow.createdAt
    ).slice(0, workflow.numberOfStories);

    const totalProgress = workflow.numberOfStories > 0 
      ? (workflow.completedStories + workflow.failedStories) / workflow.numberOfStories 
      : 0;

    return {
      workflow,
      stories: workflowStories,
      totalProgress,
    };
  }

  static async getStoryForContinuation(
    storyId: string
  ): Promise<{
    story: Story | null;
    episodes: Episode[];
    nextEpisodeNumber: number;
    preferences: UserPreferencesData | null;
  }> {
    const { story, episodes } = await this.getStoryWithEpisodes(storyId);
    
    if (!story) {
      return {
        story: null,
        episodes: [],
        nextEpisodeNumber: 1,
        preferences: null,
      };
    }

    const nextEpisodeNumber = await EpisodeContinuationAccess.getNextEpisodeNumber(storyId);
    
    const userPreferences = await BatchUserPreferencesAccess.getPreferencesForStoryGeneration(story.userId);
    
    return {
      story,
      episodes,
      nextEpisodeNumber,
      preferences: userPreferences?.preferences || null,
    };
  }
}
