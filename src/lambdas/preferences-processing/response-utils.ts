import { APIGatewayProxyResult } from "aws-lambda";

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

  // Event Publishing
  EVENT_PUBLISHING_ERROR: "EVENT_PUBLISHING_ERROR",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // Generic
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
} as const;
