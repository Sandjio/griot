import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import AWSXRay from "aws-xray-sdk-core";
import { UserPreferencesAccess } from "../../database/access-patterns";
import { UserPreferencesData, QlooInsights } from "../../types/data-models";
import { QlooApiClient } from "./qloo-client"; // cspell:ignore qloo
import { validatePreferences } from "./validation";
import {
  createErrorResponse,
  createSuccessResponse,
  createGetPreferencesResponse,
  createPostPreferencesResponse,
  createEmptyPreferencesResponse,
  createUnauthorizedResponse,
  createValidationErrorResponse,
  createInvalidJsonResponse,
  createMissingBodyResponse,
  createPreferencesRetrievalErrorResponse,
  createPreferencesStorageErrorResponse,
  createQlooApiErrorResponse,
  createMethodNotAllowedResponse,
  createRateLimitResponse,
  createInternalErrorResponse,
  ErrorCodes,
  HttpStatusCodes,
} from "./response-utils";
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
      const response = createValidationErrorResponse(
        "Request validation failed",
        event.requestContext.requestId
      );
      return {
        ...response,
        headers: {
          ...response.headers,
          ...SECURITY_HEADERS,
        },
      };
    }

    // Extract user ID from Cognito claims
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      subsegment?.addError(new Error("User not authenticated"));
      subsegment?.close();
      const response = createUnauthorizedResponse(
        event.requestContext.requestId
      );
      return {
        ...response,
        headers: {
          ...response.headers,
          ...SECURITY_HEADERS,
        },
      };
    }

    // Rate limiting check
    const clientIp = event.requestContext.identity?.sourceIp || "unknown";
    const rateLimitKey = `${userId}-${clientIp}`;
    if (!RateLimiter.isAllowed(rateLimitKey, 10, 60000)) {
      // 10 requests per minute
      subsegment?.addError(new Error("Rate limit exceeded"));
      subsegment?.close();
      const response = createRateLimitResponse(event.requestContext.requestId);
      return {
        ...response,
        headers: {
          ...response.headers,
          ...SECURITY_HEADERS,
        },
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
      const response = createMethodNotAllowedResponse(
        event.httpMethod,
        event.requestContext.requestId
      );
      return {
        ...response,
        headers: {
          ...response.headers,
          ...SECURITY_HEADERS,
        },
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

    const errorResponse = createInternalErrorResponse(
      event.requestContext.requestId
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

    // Retrieve latest preferences with metadata from DynamoDB
    const dbTimer = new PerformanceTimer("DynamoDB-GetPreferences");
    const preferencesData = await UserPreferencesAccess.getLatestWithMetadata(
      userId
    );
    const dbDuration = dbTimer.stop();

    if (!preferencesData.preferences) {
      // User has no stored preferences - return empty response
      ErrorLogger.logInfo("No preferences found for user", {
        userId,
        requestId: event.requestContext.requestId,
      });

      return createEmptyPreferencesResponse(event.requestContext.requestId);
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
    return createGetPreferencesResponse(
      preferencesData.preferences,
      preferencesData.insights,
      preferencesData.lastUpdated,
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

    return createPreferencesRetrievalErrorResponse(
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
      return createMissingBodyResponse(event.requestContext.requestId);
    }

    // Parse and validate request body
    let preferences: UserPreferencesData;
    try {
      preferences = JSON.parse(event.body);
    } catch (error) {
      return createInvalidJsonResponse(event.requestContext.requestId);
    }

    // Enhanced input validation and sanitization
    const inputValidation = InputValidator.validate(
      preferences,
      PREFERENCES_VALIDATION_RULES
    );
    if (!inputValidation.isValid) {
      return createValidationErrorResponse(
        inputValidation.errors.join(", "),
        event.requestContext.requestId
      );
    }

    // Use sanitized data
    preferences = inputValidation.sanitizedData as UserPreferencesData;

    // Additional legacy validation for backward compatibility
    const legacyValidationResult = validatePreferences(preferences);
    if (!legacyValidationResult.isValid) {
      return createValidationErrorResponse(
        legacyValidationResult.errors.join(", "),
        event.requestContext.requestId
      );
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

      return createQlooApiErrorResponse(event.requestContext.requestId);
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

      return createPreferencesStorageErrorResponse(
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
    return createPostPreferencesResponse(
      preferences,
      insights,
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

    return createInternalErrorResponse(event.requestContext.requestId);
  }
};

// Export the handler wrapped with error handling
export const handler = withErrorHandling(
  preferencesProcessingHandler,
  "PreferencesProcessing"
);
