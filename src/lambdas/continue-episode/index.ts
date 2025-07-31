import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import AWSXRay from "aws-xray-sdk-core";
import {
  StoryAccess,
  EpisodeAccess,
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../../database/access-patterns";
import { EventPublisher } from "../../utils/event-publisher";
import { withErrorHandling, ErrorLogger } from "../../utils/error-handler";
import {
  BusinessMetrics,
  PerformanceTimer,
} from "../../utils/cloudwatch-metrics";
import {
  InputValidator,
  validateApiGatewayEvent,
  RateLimiter,
  SECURITY_HEADERS,
} from "../../utils/input-validation";
import { ContinueEpisodeEventDetail } from "../../types/event-schemas";

/**
 * Continue Episode Lambda Function
 *
 * Handles POST /stories/{storyId}/episodes endpoint for generating additional episodes
 * for existing manga stories. Determines the next episode number automatically,
 * retrieves original story content and user preferences, and triggers episode generation.
 *
 * Requirements: 6B.1, 6B.2, 6B.3, 6B.4, 6B.5, 6B.6
 */

interface ContinueEpisodeEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayProxyEvent["requestContext"] & {
    authorizer?: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
  pathParameters: {
    storyId: string;
  } | null;
}

interface ContinueEpisodeResponse {
  episodeId: string;
  episodeNumber: number;
  status: "GENERATING";
  estimatedCompletionTime: string;
}

/**
 * Main handler for continue episode requests
 */
const continueEpisodeHandler = async (
  event: ContinueEpisodeEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> => {
  // Start X-Ray subsegment for this operation
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment("ContinueEpisode");

  ErrorLogger.logInfo(
    "Continue Episode Lambda invoked",
    {
      requestId: event.requestContext.requestId,
      httpMethod: event.httpMethod,
      path: event.path,
      correlationId,
    },
    "ContinueEpisode"
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
      return createValidationErrorResponse(
        "Request validation failed",
        event.requestContext.requestId
      );
    }

    // Extract user ID from Cognito claims
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      subsegment?.addError(new Error("User not authenticated"));
      subsegment?.close();
      return createUnauthorizedResponse(event.requestContext.requestId);
    }

    // Extract storyId from path parameters
    const storyId = event.pathParameters?.storyId;
    if (!storyId) {
      subsegment?.addError(new Error("Story ID not provided in path"));
      subsegment?.close();
      return createValidationErrorResponse(
        "Story ID is required in path",
        event.requestContext.requestId
      );
    }

    // Rate limiting check
    const clientIp = event.requestContext.identity?.sourceIp || "unknown";
    const rateLimitKey = `continue-episode-${userId}-${clientIp}`;
    if (!RateLimiter.isAllowed(rateLimitKey, 10, 300000)) {
      // 10 requests per 5 minutes for episode continuation
      subsegment?.addError(new Error("Rate limit exceeded"));
      subsegment?.close();
      return createRateLimitResponse(event.requestContext.requestId);
    }

    // Add user context to X-Ray
    subsegment?.addAnnotation("userId", userId);
    subsegment?.addAnnotation("storyId", storyId);
    subsegment?.addMetadata("request", {
      httpMethod: event.httpMethod,
      path: event.path,
      userAgent: event.headers["User-Agent"],
      clientIp,
    });

    // Only handle POST method
    if (event.httpMethod !== "POST") {
      subsegment?.addError(
        new Error(`Unsupported HTTP method: ${event.httpMethod}`)
      );
      subsegment?.close();
      return createMethodNotAllowedResponse(
        event.httpMethod,
        event.requestContext.requestId
      );
    }

    const result = await handleContinueEpisode(
      event,
      userId,
      storyId,
      subsegment,
      correlationId
    );

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
      "ContinueEpisode"
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
 * Handle continue episode request
 */
const handleContinueEpisode = async (
  event: ContinueEpisodeEvent,
  userId: string,
  storyId: string,
  subsegment?: AWSXRay.Subsegment,
  correlationId?: string
): Promise<APIGatewayProxyResult> => {
  const operationTimer = new PerformanceTimer("ContinueEpisode");

  try {
    ErrorLogger.logInfo(
      "Processing continue episode request",
      {
        userId,
        storyId,
        requestId: event.requestContext.requestId,
        correlationId,
      },
      "ContinueEpisode"
    );

    // Verify story exists and belongs to user
    const storyTimer = new PerformanceTimer("DynamoDB-GetStory");
    const story = await StoryAccess.get(userId, storyId);
    const storyDuration = storyTimer.stop();

    if (!story) {
      ErrorLogger.logInfo("Story not found", {
        userId,
        storyId,
        requestId: event.requestContext.requestId,
      });
      return createStoryNotFoundResponse(event.requestContext.requestId);
    }

    if (story.status !== "COMPLETED") {
      ErrorLogger.logInfo("Story is not completed", {
        userId,
        storyId,
        status: story.status,
        requestId: event.requestContext.requestId,
      });
      return createStoryNotCompletedResponse(
        story.status,
        event.requestContext.requestId
      );
    }

    ErrorLogger.logInfo("Story found and verified", {
      userId,
      storyId,
      storyTitle: story.title,
      storyStatus: story.status,
      duration: storyDuration,
    });

    // Get existing episodes to determine next episode number
    const episodesTimer = new PerformanceTimer("DynamoDB-GetEpisodes");
    const existingEpisodes = await EpisodeAccess.getStoryEpisodes(storyId);
    const episodesDuration = episodesTimer.stop();

    // Determine next episode number
    const nextEpisodeNumber = existingEpisodes.length + 1;

    ErrorLogger.logInfo("Determined next episode number", {
      userId,
      storyId,
      existingEpisodesCount: existingEpisodes.length,
      nextEpisodeNumber,
      duration: episodesDuration,
    });

    // Check if episode already exists (edge case)
    const existingEpisode = existingEpisodes.find(
      (ep) => ep.episodeNumber === nextEpisodeNumber
    );
    if (existingEpisode) {
      ErrorLogger.logInfo("Episode already exists", {
        userId,
        storyId,
        episodeNumber: nextEpisodeNumber,
        episodeId: existingEpisode.episodeId,
        status: existingEpisode.status,
      });
      return createEpisodeAlreadyExistsResponse(
        existingEpisode.episodeId,
        nextEpisodeNumber,
        existingEpisode.status,
        event.requestContext.requestId
      );
    }

    // Retrieve original user preferences for story generation
    const preferencesTimer = new PerformanceTimer("DynamoDB-GetPreferences");
    const preferencesData = await UserPreferencesAccess.getLatestWithMetadata(
      userId
    );
    const preferencesDuration = preferencesTimer.stop();

    if (!preferencesData.preferences) {
      ErrorLogger.logError(
        new Error("User preferences not found"),
        {
          userId,
          storyId,
          requestId: event.requestContext.requestId,
        },
        "ContinueEpisode"
      );
      return createPreferencesNotFoundResponse(event.requestContext.requestId);
    }

    ErrorLogger.logInfo("Retrieved user preferences", {
      userId,
      storyId,
      hasInsights: !!preferencesData.insights,
      duration: preferencesDuration,
    });

    // Generate episode ID and request ID
    const episodeId = uuidv4();
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    // Add episode context to X-Ray
    subsegment?.addAnnotation("episodeId", episodeId);
    subsegment?.addAnnotation("nextEpisodeNumber", nextEpisodeNumber);

    // Create generation request for tracking
    const createRequestTimer = new PerformanceTimer("DynamoDB-CreateRequest");
    await GenerationRequestAccess.create({
      requestId,
      userId,
      type: "EPISODE",
      status: "PROCESSING",
      createdAt: timestamp,
      relatedEntityId: episodeId,
    });
    const createRequestDuration = createRequestTimer.stop();

    // Publish continue episode event to trigger episode generation workflow
    const eventPublisher = new EventPublisher();
    const publishTimer = new PerformanceTimer(
      "EventBridge-PublishContinueEpisode"
    );

    const continueEpisodeEventDetail: ContinueEpisodeEventDetail = {
      userId,
      storyId,
      nextEpisodeNumber,
      originalPreferences: preferencesData.preferences,
      storyS3Key: story.s3Key,
      timestamp,
    };

    await eventPublisher.publishEvent({
      source: "manga.story",
      "detail-type": "Continue Episode Requested",
      detail: continueEpisodeEventDetail,
    });

    const publishDuration = publishTimer.stop();

    ErrorLogger.logInfo("Published continue episode event", {
      userId,
      storyId,
      episodeId,
      nextEpisodeNumber,
      requestId,
      duration: publishDuration,
    });

    // Record business metrics
    await BusinessMetrics.recordEpisodeContinuation(userId, storyId);

    // Calculate estimated completion time (rough estimate: 2 minutes for episode + images)
    const estimatedCompletionTime = new Date(
      Date.now() + 2 * 60 * 1000
    ).toISOString();

    // Record successful completion
    const totalDuration = operationTimer.stop();
    subsegment?.addAnnotation("success", true);
    subsegment?.addMetadata("performance", {
      totalDuration,
      storyDuration,
      episodesDuration,
      preferencesDuration,
      createRequestDuration,
      publishDuration,
    });

    ErrorLogger.logInfo("Continue episode request completed successfully", {
      userId,
      storyId,
      episodeId,
      nextEpisodeNumber,
      requestId,
      estimatedCompletionTime,
      totalDuration,
    });

    // Return success response
    const response: ContinueEpisodeResponse = {
      episodeId,
      episodeNumber: nextEpisodeNumber,
      status: "GENERATING",
      estimatedCompletionTime,
    };

    return createContinueEpisodeResponse(
      response,
      event.requestContext.requestId
    );
  } catch (error) {
    const totalDuration = operationTimer.stop();

    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        userId,
        storyId,
        requestId: event.requestContext.requestId,
        operation: "ContinueEpisode",
        totalDuration,
      },
      "ContinueEpisode"
    );

    return createInternalErrorResponse(event.requestContext.requestId);
  }
};

// Response helper functions
function createValidationErrorResponse(
  message: string,
  requestId: string
): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "VALIDATION_ERROR",
        message,
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createUnauthorizedResponse(requestId: string): APIGatewayProxyResult {
  return {
    statusCode: 401,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createRateLimitResponse(requestId: string): APIGatewayProxyResult {
  return {
    statusCode: 429,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
      "Retry-After": "300",
    },
    body: JSON.stringify({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message:
          "Too many episode continuation requests. Please try again later.",
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createMethodNotAllowedResponse(
  method: string,
  requestId: string
): APIGatewayProxyResult {
  return {
    statusCode: 405,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
      Allow: "POST",
    },
    body: JSON.stringify({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: `HTTP method ${method} not allowed. Use POST.`,
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createStoryNotFoundResponse(requestId: string): APIGatewayProxyResult {
  return {
    statusCode: 404,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "STORY_NOT_FOUND",
        message: "Story not found or you don't have access to it",
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createStoryNotCompletedResponse(
  currentStatus: string,
  requestId: string
): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "STORY_NOT_COMPLETED",
        message: `Cannot continue episodes for story with status: ${currentStatus}. Story must be completed first.`,
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createEpisodeAlreadyExistsResponse(
  episodeId: string,
  episodeNumber: number,
  status: string,
  requestId: string
): APIGatewayProxyResult {
  return {
    statusCode: 409,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "EPISODE_ALREADY_EXISTS",
        message: `Episode ${episodeNumber} already exists with status: ${status}`,
        episodeId,
        episodeNumber,
        status,
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createPreferencesNotFoundResponse(
  requestId: string
): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "PREFERENCES_NOT_FOUND",
        message:
          "User preferences not found. Cannot continue episode without original preferences.",
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createInternalErrorResponse(requestId: string): APIGatewayProxyResult {
  return {
    statusCode: 500,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createContinueEpisodeResponse(
  response: ContinueEpisodeResponse,
  requestId: string
): APIGatewayProxyResult {
  return {
    statusCode: 202,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      ...response,
      message: "Episode generation started successfully",
      timestamp: new Date().toISOString(),
    }),
  };
}

// Export the handler wrapped with error handling
export const handler = withErrorHandling(
  continueEpisodeHandler,
  "ContinueEpisode"
);
