import {
  DynamoDBClient,
  ConditionalCheckFailedException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  PostAuthenticationTriggerEvent,
  PostAuthenticationTriggerHandler,
} from "aws-lambda";
import { UserProfile } from "../../types/data-models";
import { ErrorUtils, InternalError } from "../../types/error-types";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Environment variables validation
const MANGA_TABLE_NAME = process.env.MANGA_TABLE_NAME;
if (!MANGA_TABLE_NAME) {
  throw new Error("MANGA_TABLE_NAME environment variable is required");
}

/**
 * Creates a user profile in DynamoDB
 */
async function createUserProfile(
  userId: string,
  email: string,
  requestId: string
): Promise<void> {
  const timestamp = new Date().toISOString();

  const userProfile: UserProfile = {
    PK: `USER#${userId}`,
    SK: "PROFILE",
    GSI1PK: `USER#${userId}`,
    GSI1SK: "PROFILE",
    email: email,
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: MANGA_TABLE_NAME,
        Item: userProfile,
        ConditionExpression: "attribute_not_exists(PK)", // Prevent overwrites
      })
    );

    console.log("User profile created successfully", {
      userId,
      email,
      requestId,
      timestamp,
    });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // Profile already exists due to race condition - this is acceptable
      console.log("User profile already exists (race condition)", {
        userId,
        requestId,
      });
      return;
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Checks if a user profile already exists
 */
async function getUserProfile(
  userId: string,
  requestId: string
): Promise<UserProfile | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: MANGA_TABLE_NAME,
        Key: {
          PK: `USER#${userId}`,
          SK: "PROFILE",
        },
      })
    );

    if (result.Item) {
      console.log("Existing user profile found", {
        userId,
        requestId,
      });
      return result.Item as UserProfile;
    }

    return null;
  } catch (error) {
    console.error("Error checking existing user profile", {
      userId,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Validates required user attributes from Cognito
 */
function validateUserAttributes(
  userAttributes: Record<string, string>,
  requestId: string
): { userId: string; email: string } | null {
  const userId = userAttributes.sub;
  const email = userAttributes.email;

  if (!userId || !email) {
    const error = ErrorUtils.createValidationError(
      "Missing required user attributes",
      [
        ...(userId
          ? []
          : [{ field: "sub", value: userId, constraint: "required" }]),
        ...(email
          ? []
          : [{ field: "email", value: email, constraint: "required" }]),
      ],
      requestId
    );

    ErrorUtils.logError(error, {
      function: "validateUserAttributes",
      userAttributes: { sub: !!userId, email: !!email },
    });

    return null;
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    const error = ErrorUtils.createValidationError(
      "Invalid email format",
      [{ field: "email", value: email, constraint: "valid email format" }],
      requestId
    );

    ErrorUtils.logError(error, {
      function: "validateUserAttributes",
    });

    return null;
  }

  return { userId, email };
}

export const handler: PostAuthenticationTriggerHandler = async (
  event: PostAuthenticationTriggerEvent
) => {
  const requestId =
    event.request?.clientMetadata?.requestId ||
    `post-auth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  console.log("Post Authentication Trigger started", {
    requestId,
    userPoolId: event.userPoolId,
    userName: event.userName,
    triggerSource: event.triggerSource,
  });

  try {
    // Validate user attributes
    const validatedAttributes = validateUserAttributes(
      event.request.userAttributes,
      requestId
    );

    if (!validatedAttributes) {
      // Validation failed - log error but don't block authentication
      console.warn(
        "User attribute validation failed, skipping profile creation",
        {
          requestId,
          userName: event.userName,
        }
      );
      return event;
    }

    const { userId, email } = validatedAttributes;

    // Check if user profile already exists
    const existingProfile = await getUserProfile(userId, requestId);

    if (existingProfile) {
      console.log("User profile already exists, skipping creation", {
        requestId,
        userId,
        profileCreatedAt: existingProfile.createdAt,
      });
      return event;
    }

    // Create new user profile
    await createUserProfile(userId, email, requestId);

    console.log("Post Authentication Trigger completed successfully", {
      requestId,
      userId,
      email,
    });

    return event;
  } catch (error) {
    // Create structured error for logging
    const internalError: InternalError = ErrorUtils.createError(
      "INTERNAL_ERROR",
      "Failed to process post authentication trigger",
      {
        component: "PostAuthenticationTrigger",
        operation: "createUserProfile",
        originalError: error instanceof Error ? error.message : String(error),
      },
      requestId
    ) as InternalError;

    ErrorUtils.logError(internalError, {
      userPoolId: event.userPoolId,
      userName: event.userName,
      triggerSource: event.triggerSource,
    });

    // Don't throw error to avoid blocking user authentication
    // The user can still authenticate, but their profile creation failed
    // This should trigger monitoring alerts for manual intervention
    return event;
  }
};
