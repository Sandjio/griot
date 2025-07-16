import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  PostAuthenticationTriggerEvent,
  PostAuthenticationTriggerHandler,
} from "aws-lambda";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

interface UserProfile {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  userId: string;
  email: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  status: "ACTIVE" | "INACTIVE";
  profileComplete: boolean;
  preferences: any;
  entityType: string;
}

export const handler: PostAuthenticationTriggerHandler = async (
  event: PostAuthenticationTriggerEvent
) => {
  console.log("Post Authentication Trigger:", JSON.stringify(event, null, 2));

  try {
    const userId = event.request.userAttributes.sub;
    const email = event.request.userAttributes.email;
    const username = event.userName;
    const timestamp = new Date().toISOString();

    if (!userId || !email) {
      console.error("Missing required user attributes:", { userId, email });
      return event;
    }

    // Check if user profile already exists
    const existingUser = await docClient.send(
      new GetCommand({
        TableName: process.env.MANGA_TABLE_NAME!,
        Key: {
          PK: `USER#${userId}`,
          SK: "PROFILE",
        },
      })
    );

    // Only create profile if it doesn't exist (handles multiple auth events)
    if (!existingUser.Item) {
      const userProfile: UserProfile = {
        PK: `USER#${userId}`,
        SK: "PROFILE",
        GSI1PK: `USER#${userId}`,
        GSI1SK: "PROFILE",
        userId: userId,
        email: email,
        username: username,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "ACTIVE",
        profileComplete: false,
        preferences: null,
        entityType: "USER_PROFILE",
      };

      await docClient.send(
        new PutCommand({
          TableName: process.env.MANGA_TABLE_NAME!,
          Item: userProfile,
          ConditionExpression: "attribute_not_exists(PK)", // Prevent overwrites
        })
      );

      console.log(`User profile created for userId: ${userId}`);
    } else {
      console.log(`User profile already exists for userId: ${userId}`);
    }

    return event;
  } catch (error) {
    console.error("Error in Post Authentication Trigger:", error);
    // Don't throw error to avoid blocking user authentication
    // Log error for monitoring and alerting
    return event;
  }
};
