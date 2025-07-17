import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../../database/access-patterns";
import { EventPublishingHelpers } from "../../utils/event-publisher";
import { UserPreferencesData, QlooInsights } from "../../types/data-models";
import { QlooApiClient } from "./qloo-client"; // cspell:ignore qloo
import { validatePreferences } from "./validation";
import { createErrorResponse, createSuccessResponse } from "./response-utils";

/**
 * Preferences Processing Lambda Function
 *
 * Handles user preference submission, integrates with Qloo API for insights,
 * stores data in DynamoDB, and publishes events for story generation.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

interface PreferencesProcessingEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayProxyEvent["requestContext"] & {
    authorizer?: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
}

export const handler = async (
  event: PreferencesProcessingEvent
): Promise<APIGatewayProxyResult> => {
  console.log("Preferences Processing Lambda invoked", {
    requestId: event.requestContext.requestId,
    httpMethod: event.httpMethod,
    path: event.path,
  });

  try {
    // Extract user ID from Cognito claims
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, "UNAUTHORIZED", "User not authenticated");
    }

    // Parse and validate request body
    if (!event.body) {
      return createErrorResponse(
        400,
        "INVALID_REQUEST",
        "Request body is required"
      );
    }

    let preferences: UserPreferencesData;
    try {
      preferences = JSON.parse(event.body);
    } catch (error) {
      return createErrorResponse(
        400,
        "INVALID_JSON",
        "Invalid JSON in request body"
      );
    }

    // Validate preferences data
    const validationResult = validatePreferences(preferences);
    if (!validationResult.isValid) {
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        validationResult.errors.join(", ")
      );
    }

    // Generate unique request ID for tracking
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    console.log("Processing preferences for user", {
      userId,
      requestId,
      preferences: {
        genres: preferences.genres,
        themes: preferences.themes,
        artStyle: preferences.artStyle,
        targetAudience: preferences.targetAudience,
        contentRating: preferences.contentRating,
      },
    });

    // Create generation request record
    await GenerationRequestAccess.create({
      requestId,
      userId,
      type: "STORY",
      status: "PENDING",
      createdAt: timestamp,
    });

    // Initialize Qloo API client
    const qlooClient = new QlooApiClient();
    let insights: QlooInsights;

    try {
      // Fetch insights from Qloo API with retry logic
      insights = await qlooClient.fetchInsights(preferences);

      console.log("Successfully fetched Qloo insights", {
        userId,
        requestId,
        insightsCount: insights.recommendations.length,
        trendsCount: insights.trends.length,
      });
    } catch (error) {
      console.error("Failed to fetch Qloo insights", {
        userId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update request status to failed
      await GenerationRequestAccess.updateStatus(userId, requestId, "FAILED", {
        errorMessage: "Failed to fetch user insights from Qloo API",
      });

      return createErrorResponse(
        500,
        "QLOO_API_ERROR",
        "Failed to process user preferences. Please try again later."
      );
    }

    try {
      // Store preferences and insights in DynamoDB
      await UserPreferencesAccess.create(userId, {
        preferences,
        insights,
      });

      console.log("Successfully stored preferences and insights", {
        userId,
        requestId,
      });
    } catch (error) {
      console.error("Failed to store preferences in DynamoDB", {
        userId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update request status to failed
      await GenerationRequestAccess.updateStatus(userId, requestId, "FAILED", {
        errorMessage: "Failed to store user preferences",
      });

      return createErrorResponse(
        500,
        "DATABASE_ERROR",
        "Failed to save preferences. Please try again later."
      );
    }

    try {
      // Update request status to processing
      await GenerationRequestAccess.updateStatus(
        userId,
        requestId,
        "PROCESSING"
      );

      // Publish story generation event to EventBridge
      await EventPublishingHelpers.publishStoryGeneration(
        userId,
        requestId,
        preferences,
        insights
      );

      console.log("Successfully published story generation event", {
        userId,
        requestId,
      });
    } catch (error) {
      console.error("Failed to publish story generation event", {
        userId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update request status to failed
      await GenerationRequestAccess.updateStatus(userId, requestId, "FAILED", {
        errorMessage: "Failed to initiate story generation",
      });

      return createErrorResponse(
        500,
        "EVENT_PUBLISHING_ERROR",
        "Failed to initiate story generation. Please try again later."
      );
    }

    // Return success response with request ID for tracking
    return createSuccessResponse({
      requestId,
      status: "PROCESSING",
      message:
        "Preferences submitted successfully. Story generation has been initiated.",
      estimatedCompletionTime: "2-3 minutes",
    });
  } catch (error) {
    console.error("Unexpected error in preferences processing", {
      requestId: event.requestContext.requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later."
    );
  }
};
