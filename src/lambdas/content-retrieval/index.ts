import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  StoryAccess,
  EpisodeAccess,
  BatchOperations,
} from "../../database/access-patterns";
import { Story, Episode } from "../../types/data-models";
import {
  withErrorHandling,
  CorrelationContext,
  ErrorLogger,
} from "../../utils/error-handler";
import {
  InputValidator,
  validateApiGatewayEvent,
  QUERY_PARAM_VALIDATION_RULES,
  PATH_PARAM_VALIDATION_RULES,
  RateLimiter,
  SECURITY_HEADERS,
} from "../../utils/input-validation";

interface AuthorizedEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayProxyEvent["requestContext"] & {
    authorizer: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    requestId: string;
    timestamp: string;
  };
}

interface SuccessResponse {
  success: boolean;
  message: string;
  data: any;
  requestId: string;
  timestamp: string;
}

/**
 * Content Retrieval Lambda Function
 * Handles GET requests for stories and episodes
 *
 * Endpoints:
 * - GET /stories - Retrieve user's generated stories
 * - GET /stories/{storyId} - Get specific story details
 * - GET /episodes/{episodeId} - Get specific episode
 */
const contentRetrievalHandler = async (
  event: AuthorizedEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const timestamp = new Date().toISOString();
  const userId = event.requestContext.authorizer.claims.sub;
  const path = event.path;
  const method = event.httpMethod;

  ErrorLogger.logInfo(
    `Processing ${method} ${path} for user ${userId}`,
    {
      requestId,
      userId,
      path,
      method,
      correlationId,
    },
    "ContentRetrieval"
  );

  try {
    // Validate API Gateway event for security
    const eventValidation = validateApiGatewayEvent(event);
    if (!eventValidation.isValid) {
      ErrorLogger.logError(
        new Error(
          `Event validation failed: ${eventValidation.errors.join(", ")}`
        ),
        { requestId, userId, correlationId },
        "ContentRetrieval"
      );
      return createErrorResponse(
        400,
        "INVALID_REQUEST",
        "Request validation failed",
        requestId,
        timestamp
      );
    }

    // Rate limiting check
    const clientIp = event.requestContext.identity?.sourceIp || "unknown";
    const rateLimitKey = `${userId}-${clientIp}`;
    if (!RateLimiter.isAllowed(rateLimitKey, 50, 60000)) {
      // 50 requests per minute for read operations
      ErrorLogger.logError(
        new Error("Rate limit exceeded"),
        { requestId, userId, clientIp, correlationId },
        "ContentRetrieval"
      );
      return createErrorResponse(
        429,
        "RATE_LIMIT_EXCEEDED",
        "Too many requests. Please try again later.",
        requestId,
        timestamp
      );
    }

    // Route based on path and method
    if (method === "GET") {
      if (path === "/stories") {
        return await handleGetStories(event, userId, requestId, timestamp);
      } else if (path.startsWith("/stories/")) {
        const storyId = event.pathParameters?.storyId;
        if (!storyId) {
          return createErrorResponse(
            400,
            "INVALID_PATH",
            "Story ID is required",
            requestId,
            timestamp
          );
        }

        // Validate story ID format
        const storyIdValidation = InputValidator.validate({ storyId }, [
          PATH_PARAM_VALIDATION_RULES.storyId,
        ]);
        if (!storyIdValidation.isValid) {
          return createErrorResponse(
            400,
            "INVALID_STORY_ID",
            storyIdValidation.errors.join(", "),
            requestId,
            timestamp
          );
        }

        return await handleGetStory(
          storyIdValidation.sanitizedData!.storyId,
          userId,
          requestId,
          timestamp
        );
      } else if (path.startsWith("/episodes/")) {
        const episodeId = event.pathParameters?.episodeId;
        if (!episodeId) {
          return createErrorResponse(
            400,
            "INVALID_PATH",
            "Episode ID is required",
            requestId,
            timestamp
          );
        }

        // Validate episode ID format
        const episodeIdValidation = InputValidator.validate({ episodeId }, [
          PATH_PARAM_VALIDATION_RULES.episodeId,
        ]);
        if (!episodeIdValidation.isValid) {
          return createErrorResponse(
            400,
            "INVALID_EPISODE_ID",
            episodeIdValidation.errors.join(", "),
            requestId,
            timestamp
          );
        }

        return await handleGetEpisode(
          episodeIdValidation.sanitizedData!.episodeId,
          userId,
          requestId,
          timestamp
        );
      }
    }

    return createErrorResponse(
      404,
      "NOT_FOUND",
      "Endpoint not found",
      requestId,
      timestamp
    );
  } catch (error) {
    console.error("Error processing request:", error);
    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "Internal server error",
      requestId,
      timestamp,
      error
    );
  }
};

/**
 * Handle GET /stories endpoint
 * Retrieves user's generated stories with optional filtering
 */
async function handleGetStories(
  event: AuthorizedEvent,
  userId: string,
  requestId: string,
  timestamp: string
): Promise<APIGatewayProxyResult> {
  try {
    // Parse and validate query parameters
    const queryParams = event.queryStringParameters || {};

    // Validate query parameters if they exist
    const validationRules = [];
    if (queryParams.limit) {
      validationRules.push(QUERY_PARAM_VALIDATION_RULES.limit);
    }
    if (queryParams.status) {
      validationRules.push(QUERY_PARAM_VALIDATION_RULES.status);
    }

    if (validationRules.length > 0) {
      const queryValidation = InputValidator.validate(
        queryParams,
        validationRules
      );
      if (!queryValidation.isValid) {
        return createErrorResponse(
          400,
          "INVALID_QUERY_PARAMS",
          queryValidation.errors.join(", "),
          requestId,
          timestamp
        );
      }
      // Use sanitized query parameters
      Object.assign(queryParams, queryValidation.sanitizedData);
    }

    const limit = Math.min(parseInt(queryParams.limit || "20"), 100); // Max 100 stories
    const status = queryParams.status as
      | "PENDING"
      | "PROCESSING"
      | "COMPLETED"
      | "FAILED"
      | undefined;

    console.log(`Fetching stories for user ${userId}`, {
      limit,
      status,
      requestId,
    });

    // Get user's stories
    const stories = await StoryAccess.getUserStories(userId, limit);

    // Filter by status if provided
    const filteredStories = status
      ? stories.filter((story) => story.status === status)
      : stories;

    // Transform stories for response (remove internal DynamoDB keys)
    const responseStories = filteredStories.map(transformStoryForResponse);

    return createSuccessResponse(
      {
        stories: responseStories,
        count: responseStories.length,
        hasMore: stories.length === limit, // Simple pagination indicator
      },
      "Stories retrieved successfully",
      requestId,
      timestamp
    );
  } catch (error) {
    console.error("Error fetching stories:", error);
    return createErrorResponse(
      500,
      "FETCH_ERROR",
      "Failed to fetch stories",
      requestId,
      timestamp,
      error
    );
  }
}

/**
 * Handle GET /stories/{storyId} endpoint
 * Retrieves specific story details with episodes
 */
async function handleGetStory(
  storyId: string,
  userId: string,
  requestId: string,
  timestamp: string
): Promise<APIGatewayProxyResult> {
  try {
    console.log(`Fetching story ${storyId} for user ${userId}`, {
      storyId,
      userId,
      requestId,
    });

    // Get story and episodes in one operation
    const { story, episodes } = await BatchOperations.getStoryWithEpisodes(
      storyId
    );

    if (!story) {
      return createErrorResponse(
        404,
        "STORY_NOT_FOUND",
        "Story not found",
        requestId,
        timestamp
      );
    }

    // Verify user owns this story
    if (!story.PK.includes(userId)) {
      return createErrorResponse(
        403,
        "ACCESS_DENIED",
        "Access denied to this story",
        requestId,
        timestamp
      );
    }

    // Transform data for response
    const responseStory = transformStoryForResponse(story);
    const responseEpisodes = episodes.map(transformEpisodeForResponse);

    return createSuccessResponse(
      {
        story: responseStory,
        episodes: responseEpisodes,
        episodeCount: responseEpisodes.length,
      },
      "Story retrieved successfully",
      requestId,
      timestamp
    );
  } catch (error) {
    console.error("Error fetching story:", error);
    return createErrorResponse(
      500,
      "FETCH_ERROR",
      "Failed to fetch story",
      requestId,
      timestamp,
      error
    );
  }
}

/**
 * Handle GET /episodes/{episodeId} endpoint
 * Retrieves specific episode details
 */
async function handleGetEpisode(
  episodeId: string,
  userId: string,
  requestId: string,
  timestamp: string
): Promise<APIGatewayProxyResult> {
  try {
    console.log(`Fetching episode ${episodeId} for user ${userId}`, {
      episodeId,
      userId,
      requestId,
    });

    // Get episode by ID
    const episode = await EpisodeAccess.getByEpisodeId(episodeId);

    if (!episode) {
      return createErrorResponse(
        404,
        "EPISODE_NOT_FOUND",
        "Episode not found",
        requestId,
        timestamp
      );
    }

    // Get the story to verify user ownership
    const story = await StoryAccess.getByStoryId(episode.storyId);
    if (!story || !story.PK.includes(userId)) {
      return createErrorResponse(
        403,
        "ACCESS_DENIED",
        "Access denied to this episode",
        requestId,
        timestamp
      );
    }

    // Transform data for response
    const responseEpisode = transformEpisodeForResponse(episode);
    const responseStory = transformStoryForResponse(story);

    return createSuccessResponse(
      {
        episode: responseEpisode,
        story: responseStory,
      },
      "Episode retrieved successfully",
      requestId,
      timestamp
    );
  } catch (error) {
    console.error("Error fetching episode:", error);
    return createErrorResponse(
      500,
      "FETCH_ERROR",
      "Failed to fetch episode",
      requestId,
      timestamp,
      error
    );
  }
}

/**
 * Transform Story entity for API response
 * Removes internal DynamoDB keys and adds computed fields
 */
function transformStoryForResponse(story: Story) {
  return {
    storyId: story.storyId,
    title: story.title,
    status: story.status,
    s3Key: story.s3Key,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
}

/**
 * Transform Episode entity for API response
 * Removes internal DynamoDB keys and adds computed fields
 */
function transformEpisodeForResponse(episode: Episode) {
  return {
    episodeId: episode.episodeId,
    episodeNumber: episode.episodeNumber,
    storyId: episode.storyId,
    status: episode.status,
    s3Key: episode.s3Key,
    pdfS3Key: episode.pdfS3Key,
    createdAt: episode.createdAt,
    updatedAt: episode.updatedAt,
  };
}

/**
 * Create standardized success response with security headers
 */
function createSuccessResponse(
  data: any,
  message: string,
  requestId: string,
  timestamp: string
): APIGatewayProxyResult {
  const response: SuccessResponse = {
    success: true,
    message,
    data,
    requestId,
    timestamp,
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      ...SECURITY_HEADERS,
    },
    body: JSON.stringify(response),
  };
}

/**
 * Create standardized error response with security headers
 */
function createErrorResponse(
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  timestamp: string,
  details?: any
): APIGatewayProxyResult {
  const response: ErrorResponse = {
    error: {
      code,
      message,
      requestId,
      timestamp,
      ...(details && { details }),
    },
  };

  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      ...SECURITY_HEADERS,
      ...(statusCode === 429 ? { "Retry-After": "60" } : {}),
    },
    body: JSON.stringify(response),
  };
}

// Export the handler wrapped with error handling
export const handler = withErrorHandling(
  contentRetrievalHandler,
  "ContentRetrieval"
);
