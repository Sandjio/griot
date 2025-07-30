import { APIGatewayProxyResult } from "aws-lambda";
import { UserPreferencesData, QlooInsights } from "../../types/data-models";

/**
 * Response utilities for consistent API responses
 *
 * Provides standardized success and error response formats
 */

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId?: string;
    timestamp: string;
  };
}

interface SuccessResponse<T = any> {
  success: true;
  data: T;
  requestId?: string;
  timestamp: string;
}

/**
 * Response data structure for GET preferences endpoint
 */
export interface GetPreferencesResponseData {
  preferences: UserPreferencesData | null;
  insights?: QlooInsights;
  lastUpdated?: string;
  message?: string;
}

/**
 * Response data structure for POST preferences endpoint
 */
export interface PostPreferencesResponseData {
  message: string;
  preferences: UserPreferencesData;
  insights: QlooInsights;
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  statusCode: number,
  errorCode: string,
  message: string,
  requestId?: string
): APIGatewayProxyResult {
  const response: ErrorResponse = {
    error: {
      code: errorCode,
      message,
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(response),
  };
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse<T>(
  data: T,
  statusCode: number = 200,
  requestId?: string
): APIGatewayProxyResult {
  const response: SuccessResponse<T> = {
    success: true,
    data,
    requestId,
    timestamp: new Date().toISOString(),
  };

  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(response),
  };
}

/**
 * Create a response for OPTIONS requests (CORS preflight)
 */
export function createOptionsResponse(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

/**
 * Create a success response for GET preferences endpoint
 */
export function createGetPreferencesResponse(
  preferences: UserPreferencesData | null,
  insights?: QlooInsights,
  lastUpdated?: string,
  requestId?: string
): APIGatewayProxyResult {
  const responseData: GetPreferencesResponseData = {
    preferences,
    insights,
    lastUpdated,
  };

  // Add message for empty preferences case
  if (!preferences) {
    responseData.message = "No preferences found for user";
  }

  return createSuccessResponse(responseData, 200, requestId);
}

/**
 * Create a success response for POST preferences endpoint
 */
export function createPostPreferencesResponse(
  preferences: UserPreferencesData,
  insights: QlooInsights,
  requestId?: string
): APIGatewayProxyResult {
  const responseData: PostPreferencesResponseData = {
    message: "Preferences saved successfully",
    preferences,
    insights,
  };

  return createSuccessResponse(responseData, 200, requestId);
}

/**
 * Create an empty preferences response for GET endpoint when user has no stored preferences
 */
export function createEmptyPreferencesResponse(
  requestId?: string
): APIGatewayProxyResult {
  const responseData: GetPreferencesResponseData = {
    preferences: null,
    message: "No preferences found for user",
  };

  return createSuccessResponse(responseData, 200, requestId);
}

/**
 * Create an error response for authentication failures
 */
export function createUnauthorizedResponse(
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.UNAUTHORIZED,
    ErrorCodes.UNAUTHORIZED,
    "User not authenticated",
    requestId
  );
}

/**
 * Create an error response for validation failures
 */
export function createValidationErrorResponse(
  message: string,
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.BAD_REQUEST,
    ErrorCodes.VALIDATION_ERROR,
    message,
    requestId
  );
}

/**
 * Create an error response for invalid JSON
 */
export function createInvalidJsonResponse(
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.BAD_REQUEST,
    ErrorCodes.INVALID_JSON,
    "Invalid JSON in request body",
    requestId
  );
}

/**
 * Create an error response for missing request body
 */
export function createMissingBodyResponse(
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.BAD_REQUEST,
    ErrorCodes.INVALID_REQUEST,
    "Request body is required",
    requestId
  );
}

/**
 * Create an error response for preferences retrieval failures
 */
export function createPreferencesRetrievalErrorResponse(
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.INTERNAL_SERVER_ERROR,
    ErrorCodes.PREFERENCES_RETRIEVAL_ERROR,
    "Failed to retrieve preferences. Please try again later.",
    requestId
  );
}

/**
 * Create an error response for preferences storage failures
 */
export function createPreferencesStorageErrorResponse(
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.INTERNAL_SERVER_ERROR,
    ErrorCodes.PREFERENCES_STORAGE_ERROR,
    "Failed to save preferences. Please try again later.",
    requestId
  );
}

/**
 * Create an error response for Qloo API failures
 */
export function createQlooApiErrorResponse(
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.INTERNAL_SERVER_ERROR,
    ErrorCodes.QLOO_API_ERROR,
    "Failed to process user preferences. Please try again later.",
    requestId
  );
}

/**
 * Create an error response for unsupported HTTP methods
 */
export function createMethodNotAllowedResponse(
  method: string,
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.METHOD_NOT_ALLOWED,
    ErrorCodes.METHOD_NOT_ALLOWED,
    `HTTP method ${method} is not supported`,
    requestId
  );
}

/**
 * Create an error response for rate limiting
 */
export function createRateLimitResponse(
  requestId?: string
): APIGatewayProxyResult {
  const response = createErrorResponse(
    HttpStatusCodes.TOO_MANY_REQUESTS,
    ErrorCodes.RATE_LIMIT_EXCEEDED,
    "Too many requests. Please try again later.",
    requestId
  );

  // Add Retry-After header for rate limiting
  response.headers = {
    ...response.headers,
    "Retry-After": "60",
  };

  return response;
}

/**
 * Create a generic internal error response
 */
export function createInternalErrorResponse(
  requestId?: string
): APIGatewayProxyResult {
  return createErrorResponse(
    HttpStatusCodes.INTERNAL_SERVER_ERROR,
    ErrorCodes.INTERNAL_ERROR,
    "An unexpected error occurred. Please try again later.",
    requestId
  );
}

/**
 * Extract request ID from Lambda context or event
 */
export function extractRequestId(event: any, context?: any): string {
  return event.requestContext?.requestId || context?.awsRequestId || "unknown";
}

/**
 * Common HTTP status codes
 */
export const HttpStatusCodes = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

/**
 * Common error codes
 */
export const ErrorCodes = {
  // Authentication & Authorization
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_TOKEN: "INVALID_TOKEN",

  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_JSON: "INVALID_JSON",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",

  // External Services
  QLOO_API_ERROR: "QLOO_API_ERROR",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",

  // Database
  DATABASE_ERROR: "DATABASE_ERROR",
  RECORD_NOT_FOUND: "RECORD_NOT_FOUND",
  DUPLICATE_RECORD: "DUPLICATE_RECORD",

  // Preferences-specific errors
  PREFERENCES_NOT_FOUND: "PREFERENCES_NOT_FOUND",
  PREFERENCES_RETRIEVAL_ERROR: "PREFERENCES_RETRIEVAL_ERROR",
  PREFERENCES_STORAGE_ERROR: "PREFERENCES_STORAGE_ERROR",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // HTTP Methods
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",

  // Generic
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
} as const;
