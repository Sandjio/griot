import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import AWSXRay from "aws-xray-sdk-core";
import { UserPreferencesAccess } from "../../database/access-patterns";
import { UserPreferencesData, QlooInsights } from "../../types/data-models";
import { QlooApiClient } from "./qloo-client"; // cspell:ignore qloo
import { validatePreferences } from "./validation";
import { createErrorResponse, createSuccessResponse } from "./response-utils";
import { withErrorHandling, ErrorLogger } from "../../utils/error-handler";
import {
  BusinessMetrics,
  PerformanceTimer,
} from "../../utils/cloudwatch-metrics";
import {
  InputValidator,
  validateApiGatewayEvent,
  PREFERENCES_VALIDATION_RULES,
  RateLimiter,
  SECURITY_HEADERS,
} from "../../utils/input-validation";

// Enable X-Ray tracing for AWS SDK
// Note: AWS SDK v3 doesn't require explicit capturing for X-Ray

/**
 * Preferences Processing Lambda Function
 *
 * Handles user preference submission and retrieval.
 * - POST: Integrates with Qloo API for insights and stores data in DynamoDB
 * - GET: Retrieves user preferences from DynamoDB
 *
 * Requirements: 1.1, 1.4, 2.1, 2.2
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

/**
 * Main handler that routes between GET and POST methods
 */
const preferencesProcessingHandler = async (
  event: PreferencesProcessingEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> => {
  // Start X-Ray subsegment for this operation
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment("PreferencesProcessing");

  ErrorLogger.logInfo(
    "Preferences Processing Lambda invoked",
    {
      requestId: event.requestContext.requestId,
      httpMethod: event.httpMethod,
      path: event.path,
      correlationId,
    },
    "PreferencesProcessing"
  );

  try {
    // Validate API Gateway event for security
    const eventValidation = validateApiGatewayEvent(event);
    if (!eventValidation.isValid) {
      subsegment?.addError(
        new Error(
          `Event validation failed: ${eventValidation.errors.join(", ")}`
        )
      );
      subsegment?.close();
      return {
        statusCode: 400,
        headers: SECURITY_HEADERS,
        body: JSON.stringify({
          error: {
            code: "INVALID_REQUEST",
            message: "Request validation failed",
            requestId: event.requestContext.requestId,
            timestamp: new Date().toISOString(),
          },
        }),
      };
    }

    // Extract user ID from Cognito claims
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      subsegment?.addError(new Error("User not authenticated"));
      subsegment?.close();
      return {
        statusCode: 401,
        headers: SECURITY_HEADERS,
        body: JSON.stringify({
          error: {
            code: "UNAUTHORIZED",
            message: "User not authenticated",
            requestId: event.requestContext.requestId,
            timestamp: new Date().toISOString(),
          },
        }),
      };
    }

    // Rate limiting check
    const clientIp = event.requestContext.identity?.sourceIp || "unknown";
    const rateLimitKey = `${userId}-${clientIp}`;
    if (!RateLimiter.isAllowed(rateLimitKey, 10, 60000)) {
      // 10 requests per minute
      subsegment?.addError(new Error("Rate limit exceeded"));
      subsegment?.close();
      return {
        statusCode: 429,
        headers: {
          ...SECURITY_HEADERS,
          "Retry-After": "60",
        },
        body: JSON.stringify({
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please try again later.",
            requestId: event.requestContext.requestId,
            timestamp: new Date().toISOString(),
          },
        }),
      };
    }

    // Add user context to X-Ray
    subsegment?.addAnnotation("userId", userId);
    subsegment?.addMetadata("request", {
      httpMethod: event.httpMethod,
      path: event.path,
      userAgent: event.headers["User-Agent"],
      clientIp,
    });

    // Route to appropriate handler based on HTTP method
    let result: APIGatewayProxyResult;
    if (event.httpMethod === "GET") {
      result = await handleGetPreferences(event, userId, subsegment);
    } else if (event.httpMethod === "POST") {
      result = await handlePostPreferences(
        event,
        userId,
        subsegment,
        correlationId
      );
    } else {
      subsegment?.addError(
        new Error(`Unsupported HTTP method: ${event.httpMethod}`)
      );
      subsegment?.close();
      return {
        statusCode: 405,
        headers: SECURITY_HEADERS,
        body: JSON.stringify({
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: `HTTP method ${event.httpMethod} is not supported`,
            requestId: event.requestContext.requestId,
            timestamp: new Date().toISOString(),
          },
        }),
      };
    }

    subsegment?.close();
    return {
      ...result,
      headers: {
        ...result.headers,
        ...SECURITY_HEADERS,
      },
    };
  } catch (error) {
    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        requestId: event.requestContext.requestId,
        correlationId,
      },
      "PreferencesProcessing"
    );

    subsegment?.addError(
      error instanceof Error ? error : new Error(String(error))
    );
    subsegment?.close();

    const errorResponse = createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later."
    );

    return {
      ...errorResponse,
      headers: {
        ...errorResponse.headers,
        ...SECURITY_HEADERS,
      },
    };
  }
};

/**
 * Handle GET requests to retrieve user preferences
 */
const handleGetPreferences = async (
  event: PreferencesProcessingEvent,
  userId: string,
  subsegment?: AWSXRay.Subsegment
): Promise<APIGatewayProxyResult> => {
  const operationTimer = new PerformanceTimer("GetPreferences");

  try {
    ErrorLogger.logInfo("Retrieving preferences for user", {
      userId,
      requestId: event.requestContext.requestId,
    });

    // Retrieve latest preferences from DynamoDB
    const dbTimer = new PerformanceTimer("DynamoDB-GetPreferences");
    const userPreferences = await UserPreferencesAccess.getLatest(userId);
    const dbDuration = dbTimer.stop();

    if (!userPreferences) {
      // User has no stored preferences - return empty response
      ErrorLogger.logInfo("No preferences found for user", {
        userId,
        requestId: event.requestContext.requestId,
      });

      return createSuccessResponse(
        {
          preferences: null,
          message: "No preferences found for user",
        },
        200,
        event.requestContext.requestId
      );
    }

    // Record successful retrieval
    const totalDuration = operationTimer.stop();
    subsegment?.addAnnotation("success", true);
    subsegment?.addMetadata("performance", {
      totalDuration,
      dbDuration,
    });

    ErrorLogger.logInfo("Successfully retrieved preferences", {
      userId,
      requestId: event.requestContext.requestId,
      totalDuration,
    });

    // Return preferences with insights and metadata
    return createSuccessResponse(
      {
        preferences: userPreferences.preferences,
        insights: userPreferences.insights,
        lastUpdated: userPreferences.createdAt,
      },
      200,
      event.requestContext.requestId
    );
  } catch (error) {
    const totalDuration = operationTimer.stop();

    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        userId,
        requestId: event.requestContext.requestId,
        operation: "GetPreferences",
        totalDuration,
      },
      "PreferencesProcessing"
    );

    subsegment?.addError(
      error instanceof Error ? error : new Error(String(error))
    );

    return createErrorResponse(
      500,
      "DATABASE_ERROR",
      "Failed to retrieve preferences. Please try again later.",
      event.requestContext.requestId
    );
  }
};

/**
 * Handle POST requests to store user preferences
 */
const handlePostPreferences = async (
  event: PreferencesProcessingEvent,
  userId: string,
  subsegment?: AWSXRay.Subsegment,
  correlationId?: string
): Promise<APIGatewayProxyResult> => {
  const operationTimer = new PerformanceTimer("PostPreferences");

  try {
    // Validate request body is present
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {},
        body: JSON.stringify({
          error: {
            code: "INVALID_REQUEST",
            message: "Request body is required",
            requestId: event.requestContext.requestId,
            timestamp: new Date().toISOString(),
          },
        }),
      };
    }

    // Parse and validate request body
    let preferences: UserPreferencesData;
    try {
      preferences = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers: {},
        body: JSON.stringify({
          error: {
            code: "INVALID_JSON",
            message: "Invalid JSON in request body",
            requestId: event.requestContext.requestId,
            timestamp: new Date().toISOString(),
          },
        }),
      };
    }

    // Enhanced input validation and sanitization
    const inputValidation = InputValidator.validate(
      preferences,
      PREFERENCES_VALIDATION_RULES
    );
    if (!inputValidation.isValid) {
      return {
        statusCode: 400,
        headers: {},
        body: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: inputValidation.errors.join(", "),
            requestId: event.requestContext.requestId,
            timestamp: new Date().toISOString(),
          },
        }),
      };
    }

    // Use sanitized data
    preferences = inputValidation.sanitizedData as UserPreferencesData;

    // Additional legacy validation for backward compatibility
    const legacyValidationResult = validatePreferences(preferences);
    if (!legacyValidationResult.isValid) {
      return {
        statusCode: 400,
        headers: {},
        body: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: legacyValidationResult.errors.join(", "),
            requestId: event.requestContext.requestId,
            timestamp: new Date().toISOString(),
          },
        }),
      };
    }

    // Add request context to X-Ray
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
        requestId: event.requestContext.requestId,
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

    // Initialize Qloo API client and fetch insights
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

        qlooSubsegment?.addAnnotation("success", true);
        qlooSubsegment?.addMetadata("response", {
          recommendationsCount: insights.recommendations.length,
          trendsCount: insights.trends.length,
          duration: qlooDuration,
        });
        qlooSubsegment?.close();

        ErrorLogger.logInfo("Successfully fetched Qloo insights", {
          userId,
          requestId: event.requestContext.requestId,
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
        {
          userId,
          requestId: event.requestContext.requestId,
          operation: "QlooAPI",
        },
        "PreferencesProcessing"
      );

      return createErrorResponse(
        500,
        "QLOO_API_ERROR",
        "Failed to process user preferences. Please try again later.",
        event.requestContext.requestId
      );
    }

    // Store preferences and insights in DynamoDB
    try {
      const storeTimer = new PerformanceTimer("DynamoDB-StorePreferences");
      await UserPreferencesAccess.create(userId, {
        preferences,
        insights,
      });
      const storeDuration = storeTimer.stop();

      ErrorLogger.logInfo("Successfully stored preferences and insights", {
        userId,
        requestId: event.requestContext.requestId,
        duration: storeDuration,
      });
    } catch (error) {
      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        {
          userId,
          requestId: event.requestContext.requestId,
          operation: "DynamoDB-Store",
        },
        "PreferencesProcessing"
      );

      return createErrorResponse(
        500,
        "DATABASE_ERROR",
        "Failed to save preferences. Please try again later.",
        event.requestContext.requestId
      );
    }

    // Record successful completion
    const totalDuration = operationTimer.stop();
    subsegment?.addAnnotation("success", true);
    subsegment?.addMetadata("performance", {
      totalDuration,
    });

    ErrorLogger.logInfo("Preferences processing completed successfully", {
      userId,
      requestId: event.requestContext.requestId,
      totalDuration,
    });

    // Return success response (without workflow triggering message)
    return createSuccessResponse(
      {
        message: "Preferences saved successfully",
        preferences: preferences,
        insights: insights,
      },
      200,
      event.requestContext.requestId
    );
  } catch (error) {
    const totalDuration = operationTimer.stop();

    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        userId,
        requestId: event.requestContext.requestId,
        operation: "PostPreferences",
        totalDuration,
      },
      "PreferencesProcessing"
    );

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      event.requestContext.requestId
    );
  }
};

// Export the handler wrapped with error handling
export const handler = withErrorHandling(
  preferencesProcessingHandler,
  "PreferencesProcessing"
);
