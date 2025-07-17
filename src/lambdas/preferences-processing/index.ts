import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import AWSXRay from "aws-xray-sdk-core";
import {
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../../database/access-patterns";
import { EventPublishingHelpers } from "../../utils/event-publisher";
import { UserPreferencesData, QlooInsights } from "../../types/data-models";
import { QlooApiClient } from "./qloo-client"; // cspell:ignore qloo
import { validatePreferences } from "./validation";
import { createErrorResponse, createSuccessResponse } from "./response-utils";
import {
  withErrorHandling,
  CorrelationContext,
  ErrorLogger,
} from "../../utils/error-handler";
import {
  BusinessMetrics,
  PerformanceTimer,
  METRIC_NAMESPACES,
} from "../../utils/cloudwatch-metrics";

// Enable X-Ray tracing for AWS SDK
const AWS = AWSXRay.captureAWS(require("aws-sdk"));

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

const preferencesProcessingHandler = async (
  event: PreferencesProcessingEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> => {
  // Start X-Ray subsegment for this operation
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment("PreferencesProcessing");

  // Start performance timer
  const operationTimer = new PerformanceTimer("PreferencesProcessing");

  ErrorLogger.logInfo(
    "Preferences Processing Lambda invoked",
    {
      requestId: event.requestContext.requestId,
      httpMethod: event.httpMethod,
      path: event.path,
      correlationId,
      traceId: segment?.trace_id,
    },
    "PreferencesProcessing"
  );

  try {
    // Extract user ID from Cognito claims
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      subsegment?.addError(new Error("User not authenticated"));
      subsegment?.close();
      return createErrorResponse(401, "UNAUTHORIZED", "User not authenticated");
    }

    // Add user context to X-Ray
    subsegment?.addAnnotation("userId", userId);
    subsegment?.addMetadata("request", {
      httpMethod: event.httpMethod,
      path: event.path,
      userAgent: event.headers["User-Agent"],
    });

    // Parse and validate request body
    if (!event.body) {
      subsegment?.addError(new Error("Request body is required"));
      subsegment?.close();
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
      subsegment?.addError(
        error instanceof Error ? error : new Error(String(error))
      );
      subsegment?.close();
      return createErrorResponse(
        400,
        "INVALID_JSON",
        "Invalid JSON in request body"
      );
    }

    // Validate preferences data
    const validationResult = validatePreferences(preferences);
    if (!validationResult.isValid) {
      const validationError = new Error(
        `Validation failed: ${validationResult.errors.join(", ")}`
      );
      subsegment?.addError(validationError);
      subsegment?.close();
      return createErrorResponse(
        400,
        "VALIDATION_ERROR",
        validationResult.errors.join(", ")
      );
    }

    // Generate unique request ID for tracking
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    // Add request context to X-Ray
    subsegment?.addAnnotation("requestId", requestId);
    subsegment?.addMetadata("preferences", {
      genres: preferences.genres,
      themes: preferences.themes,
      artStyle: preferences.artStyle,
      targetAudience: preferences.targetAudience,
      contentRating: preferences.contentRating,
    });

    ErrorLogger.logInfo(
      "Processing preferences for user",
      {
        userId,
        requestId,
        correlationId,
        preferences: {
          genres: preferences.genres,
          themes: preferences.themes,
          artStyle: preferences.artStyle,
          targetAudience: preferences.targetAudience,
          contentRating: preferences.contentRating,
        },
      },
      "PreferencesProcessing"
    );

    // Record business metrics
    await BusinessMetrics.recordPreferenceSubmission(userId);
    await BusinessMetrics.recordStoryGenerationRequest(userId);

    // Create generation request record with timing
    const dbTimer = new PerformanceTimer("DynamoDB-CreateRequest");
    await GenerationRequestAccess.create({
      requestId,
      userId,
      type: "STORY",
      status: "PENDING",
      createdAt: timestamp,
    });
    const dbDuration = dbTimer.stop();

    // Initialize Qloo API client
    const qlooClient = new QlooApiClient();
    let insights: QlooInsights;

    try {
      // Create X-Ray subsegment for Qloo API call
      const qlooSubsegment = subsegment?.addNewSubsegment("QlooAPI");
      const qlooTimer = new PerformanceTimer("QlooAPI");

      try {
        // Fetch insights from Qloo API with retry logic
        insights = await qlooClient.fetchInsights(preferences);

        const qlooDuration = qlooTimer.stop();

        // Record successful Qloo API metrics
        // Note: These would be called from within the QlooApiClient
        // but we're recording here for demonstration

        qlooSubsegment?.addAnnotation("success", true);
        qlooSubsegment?.addMetadata("response", {
          recommendationsCount: insights.recommendations.length,
          trendsCount: insights.trends.length,
          duration: qlooDuration,
        });
        qlooSubsegment?.close();

        ErrorLogger.logInfo("Successfully fetched Qloo insights", {
          userId,
          requestId,
          insightsCount: insights.recommendations.length,
          trendsCount: insights.trends.length,
          duration: qlooDuration,
        });
      } catch (qlooError) {
        const qlooDuration = qlooTimer.stop();

        qlooSubsegment?.addError(
          qlooError instanceof Error ? qlooError : new Error(String(qlooError))
        );
        qlooSubsegment?.addAnnotation("success", false);
        qlooSubsegment?.close();

        throw qlooError;
      }
    } catch (error) {
      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { userId, requestId, operation: "QlooAPI" },
        "PreferencesProcessing"
      );

      // Update request status to failed
      await GenerationRequestAccess.updateStatus(userId, requestId, "FAILED", {
        errorMessage: "Failed to fetch user insights from Qloo API",
      });

      // Record failure metrics
      await BusinessMetrics.recordStoryGenerationFailure(
        userId,
        "QLOO_API_ERROR"
      );

      subsegment?.addError(
        error instanceof Error ? error : new Error(String(error))
      );
      subsegment?.close();

      return createErrorResponse(
        500,
        "QLOO_API_ERROR",
        "Failed to process user preferences. Please try again later."
      );
    }

    try {
      // Store preferences and insights in DynamoDB with timing
      const storeTimer = new PerformanceTimer("DynamoDB-StorePreferences");
      await UserPreferencesAccess.create(userId, {
        preferences,
        insights,
      });
      const storeDuration = storeTimer.stop();

      ErrorLogger.logInfo("Successfully stored preferences and insights", {
        userId,
        requestId,
        duration: storeDuration,
      });
    } catch (error) {
      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { userId, requestId, operation: "DynamoDB-Store" },
        "PreferencesProcessing"
      );

      // Update request status to failed
      await GenerationRequestAccess.updateStatus(userId, requestId, "FAILED", {
        errorMessage: "Failed to store user preferences",
      });

      // Record failure metrics
      await BusinessMetrics.recordStoryGenerationFailure(
        userId,
        "DATABASE_ERROR"
      );

      subsegment?.addError(
        error instanceof Error ? error : new Error(String(error))
      );
      subsegment?.close();

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

      // Publish story generation event to EventBridge with timing
      const eventTimer = new PerformanceTimer("EventBridge-Publish");
      await EventPublishingHelpers.publishStoryGeneration(
        userId,
        requestId,
        preferences,
        insights
      );
      const eventDuration = eventTimer.stop();

      ErrorLogger.logInfo("Successfully published story generation event", {
        userId,
        requestId,
        duration: eventDuration,
      });
    } catch (error) {
      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { userId, requestId, operation: "EventBridge-Publish" },
        "PreferencesProcessing"
      );

      // Update request status to failed
      await GenerationRequestAccess.updateStatus(userId, requestId, "FAILED", {
        errorMessage: "Failed to initiate story generation",
      });

      // Record failure metrics
      await BusinessMetrics.recordStoryGenerationFailure(
        userId,
        "EVENT_PUBLISHING_ERROR"
      );

      subsegment?.addError(
        error instanceof Error ? error : new Error(String(error))
      );
      subsegment?.close();

      return createErrorResponse(
        500,
        "EVENT_PUBLISHING_ERROR",
        "Failed to initiate story generation. Please try again later."
      );
    }

    // Record successful completion
    const totalDuration = operationTimer.stop();
    subsegment?.addAnnotation("success", true);
    subsegment?.addMetadata("performance", {
      totalDuration,
      dbDuration,
    });
    subsegment?.close();

    ErrorLogger.logInfo("Preferences processing completed successfully", {
      userId,
      requestId,
      totalDuration,
    });

    // Return success response with request ID for tracking
    return createSuccessResponse({
      requestId,
      status: "PROCESSING",
      message:
        "Preferences submitted successfully. Story generation has been initiated.",
      estimatedCompletionTime: "2-3 minutes",
    });
  } catch (error) {
    const totalDuration = operationTimer.stop();

    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        requestId: event.requestContext.requestId,
        correlationId,
        totalDuration,
      },
      "PreferencesProcessing"
    );

    subsegment?.addError(
      error instanceof Error ? error : new Error(String(error))
    );
    subsegment?.close();

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later."
    );
  }
};

// Export the handler wrapped with error handling
export const handler = withErrorHandling(
  preferencesProcessingHandler,
  "PreferencesProcessing"
);
