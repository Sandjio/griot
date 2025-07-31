import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import AWSXRay from "aws-xray-sdk-core";
import {
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

/**
 * Workflow Orchestration Lambda Function
 *
 * Handles POST /workflow/start endpoint for batch manga generation.
 * Implements sequential story generation logic (one story at a time).
 * Manages workflow state and progress tracking in DynamoDB.
 *
 * Requirements: 6A.1, 6A.2, 6A.3, 6A.4, 6A.5
 */

interface WorkflowOrchestrationEvent extends APIGatewayProxyEvent {
  requestContext: APIGatewayProxyEvent["requestContext"] & {
    authorizer?: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
}

interface WorkflowStartRequest {
  numberOfStories: number;
  batchSize?: number; // Default: 1 for sequential processing
}

interface WorkflowStartResponse {
  workflowId: string;
  requestId: string;
  numberOfStories: number;
  status: "STARTED";
  estimatedCompletionTime: string;
}

interface BatchWorkflowEvent {
  userId: string;
  workflowId: string;
  requestId: string;
  numberOfStories: number;
  currentBatch: number;
  totalBatches: number;
  preferences: any;
  insights: any;
}

// Import ValidationRule type
import { ValidationRule } from "../../utils/input-validation";

// Validation rules for workflow start request
const WORKFLOW_START_VALIDATION_RULES: ValidationRule[] = [
  {
    field: "numberOfStories",
    required: true,
    type: "number",
    min: 1,
    max: 10,
  },
  {
    field: "batchSize",
    required: false,
    type: "number",
    min: 1,
    max: 5,
  },
];

/**
 * Main handler for workflow orchestration
 */
const workflowOrchestrationHandler = async (
  event: WorkflowOrchestrationEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> => {
  // Start X-Ray subsegment for this operation
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment("WorkflowOrchestration");

  ErrorLogger.logInfo(
    "Workflow Orchestration Lambda invoked",
    {
      requestId: event.requestContext.requestId,
      httpMethod: event.httpMethod,
      path: event.path,
      correlationId,
    },
    "WorkflowOrchestration"
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

    // Rate limiting check
    const clientIp = event.requestContext.identity?.sourceIp || "unknown";
    const rateLimitKey = `workflow-${userId}-${clientIp}`;
    if (!RateLimiter.isAllowed(rateLimitKey, 5, 300000)) {
      // 5 requests per 5 minutes for workflow starts
      subsegment?.addError(new Error("Rate limit exceeded"));
      subsegment?.close();
      return createRateLimitResponse(event.requestContext.requestId);
    }

    // Add user context to X-Ray
    subsegment?.addAnnotation("userId", userId);
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

    const result = await handleWorkflowStart(
      event,
      userId,
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
      "WorkflowOrchestration"
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
 * Handle workflow start request
 */
const handleWorkflowStart = async (
  event: WorkflowOrchestrationEvent,
  userId: string,
  subsegment?: AWSXRay.Subsegment,
  correlationId?: string
): Promise<APIGatewayProxyResult> => {
  const operationTimer = new PerformanceTimer("WorkflowStart");

  try {
    // Validate request body is present
    if (!event.body) {
      return createMissingBodyResponse(event.requestContext.requestId);
    }

    // Parse and validate request body
    let workflowRequest: WorkflowStartRequest;
    try {
      workflowRequest = JSON.parse(event.body);
    } catch (error) {
      return createInvalidJsonResponse(event.requestContext.requestId);
    }

    // Validate workflow request
    const inputValidation = InputValidator.validate(
      workflowRequest,
      WORKFLOW_START_VALIDATION_RULES
    );
    if (!inputValidation.isValid) {
      return createValidationErrorResponse(
        inputValidation.errors.join(", "),
        event.requestContext.requestId
      );
    }

    // Use sanitized data
    workflowRequest = inputValidation.sanitizedData as WorkflowStartRequest;

    // Set default batch size to 1 for sequential processing
    const batchSize = workflowRequest.batchSize || 1;
    const numberOfStories = workflowRequest.numberOfStories;

    ErrorLogger.logInfo(
      "Starting batch workflow",
      {
        userId,
        requestId: event.requestContext.requestId,
        numberOfStories,
        batchSize,
        correlationId,
      },
      "WorkflowOrchestration"
    );

    // Generate workflow and request IDs
    const workflowId = uuidv4();
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    // Add workflow context to X-Ray
    subsegment?.addAnnotation("workflowId", workflowId);
    subsegment?.addAnnotation("numberOfStories", numberOfStories);
    subsegment?.addAnnotation("batchSize", batchSize);

    // Query user preferences from DynamoDB
    const preferencesTimer = new PerformanceTimer("DynamoDB-GetPreferences");
    const preferencesData = await UserPreferencesAccess.getLatestWithMetadata(
      userId
    );
    const preferencesDuration = preferencesTimer.stop();

    if (!preferencesData.preferences) {
      return createPreferencesNotFoundResponse(event.requestContext.requestId);
    }

    ErrorLogger.logInfo("Retrieved user preferences for workflow", {
      userId,
      workflowId,
      requestId,
      hasInsights: !!preferencesData.insights,
      duration: preferencesDuration,
    });

    // Create generation request for workflow tracking
    const createRequestTimer = new PerformanceTimer("DynamoDB-CreateRequest");
    await GenerationRequestAccess.create({
      requestId,
      userId,
      type: "STORY",
      status: "PROCESSING",
      createdAt: timestamp,
      relatedEntityId: workflowId,
    });
    const createRequestDuration = createRequestTimer.stop();

    // Calculate total batches (for sequential processing, this is numberOfStories)
    const totalBatches = Math.ceil(numberOfStories / batchSize);

    // Publish batch workflow event to start the first batch
    const eventPublisher = new EventPublisher();
    const publishTimer = new PerformanceTimer("EventBridge-PublishWorkflow");

    const batchWorkflowEvent: BatchWorkflowEvent = {
      userId,
      workflowId,
      requestId,
      numberOfStories,
      currentBatch: 1,
      totalBatches,
      preferences: preferencesData.preferences,
      insights: preferencesData.insights || {},
    };

    await eventPublisher.publishEvent({
      source: "manga.workflow",
      "detail-type": "Batch Story Generation Requested",
      detail: {
        ...batchWorkflowEvent,
        timestamp,
      },
    });

    const publishDuration = publishTimer.stop();

    ErrorLogger.logInfo("Published batch workflow event", {
      userId,
      workflowId,
      requestId,
      currentBatch: 1,
      totalBatches,
      duration: publishDuration,
    });

    // Record business metrics
    await BusinessMetrics.recordWorkflowStart(userId, numberOfStories);

    // Calculate estimated completion time (rough estimate: 3 minutes per story)
    const estimatedMinutes = numberOfStories * 3;
    const estimatedCompletionTime = new Date(
      Date.now() + estimatedMinutes * 60 * 1000
    ).toISOString();

    // Record successful completion
    const totalDuration = operationTimer.stop();
    subsegment?.addAnnotation("success", true);
    subsegment?.addMetadata("performance", {
      totalDuration,
      preferencesDuration,
      createRequestDuration,
      publishDuration,
    });

    ErrorLogger.logInfo("Workflow orchestration completed successfully", {
      userId,
      workflowId,
      requestId,
      numberOfStories,
      totalBatches,
      estimatedCompletionTime,
      totalDuration,
    });

    // Return success response
    const response: WorkflowStartResponse = {
      workflowId,
      requestId,
      numberOfStories,
      status: "STARTED",
      estimatedCompletionTime,
    };

    return createWorkflowStartResponse(
      response,
      event.requestContext.requestId
    );
  } catch (error) {
    const totalDuration = operationTimer.stop();

    ErrorLogger.logError(
      error instanceof Error ? error : new Error(String(error)),
      {
        userId,
        requestId: event.requestContext.requestId,
        operation: "WorkflowStart",
        totalDuration,
      },
      "WorkflowOrchestration"
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
        message: "Too many workflow requests. Please try again later.",
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

function createMissingBodyResponse(requestId: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "MISSING_BODY",
        message: "Request body is required",
        requestId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

function createInvalidJsonResponse(requestId: string): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({
      error: {
        code: "INVALID_JSON",
        message: "Invalid JSON in request body",
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
          "User preferences not found. Please submit preferences before starting workflow.",
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

function createWorkflowStartResponse(
  response: WorkflowStartResponse,
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
      message: "Batch workflow started successfully",
      timestamp: new Date().toISOString(),
    }),
  };
}

// Export the handler wrapped with error handling
export const handler = withErrorHandling(
  workflowOrchestrationHandler,
  "WorkflowOrchestration"
);
