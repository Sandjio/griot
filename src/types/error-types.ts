/**
 * Error Handling Types and Utility Functions
 * These types and functions provide standardized error handling across the platform
 */

import { HttpStatusCode } from "./api-types";

// Base Error Interface
export interface BaseError {
  code: string;
  message: string;
  details?: any;
  requestId?: string;
  timestamp: string;
  stack?: string;
}

// API Error Response
export interface ApiErrorResponse {
  error: BaseError;
  statusCode: HttpStatusCode;
}

// Error Categories
export enum ErrorCategory {
  VALIDATION = "VALIDATION",
  AUTHENTICATION = "AUTHENTICATION",
  AUTHORIZATION = "AUTHORIZATION",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  RATE_LIMIT = "RATE_LIMIT",
  EXTERNAL_SERVICE = "EXTERNAL_SERVICE",
  INTERNAL = "INTERNAL",
  TIMEOUT = "TIMEOUT",
  THROTTLING = "THROTTLING",
}

// Specific Error Types
export interface ValidationError extends BaseError {
  code: "VALIDATION_ERROR";
  details: {
    field: string;
    value: any;
    constraint: string;
  }[];
}

export interface AuthenticationError extends BaseError {
  code: "AUTHENTICATION_ERROR";
  details?: {
    tokenExpired?: boolean;
    invalidToken?: boolean;
    missingToken?: boolean;
  };
}

export interface AuthorizationError extends BaseError {
  code: "AUTHORIZATION_ERROR";
  details?: {
    requiredPermission?: string;
    userRole?: string;
  };
}

export interface NotFoundError extends BaseError {
  code: "NOT_FOUND_ERROR";
  details?: {
    resource: string;
    identifier: string;
  };
}

export interface ConflictError extends BaseError {
  code: "CONFLICT_ERROR";
  details?: {
    conflictingResource?: string;
    conflictReason?: string;
  };
}

export interface RateLimitError extends BaseError {
  code: "RATE_LIMIT_ERROR";
  details?: {
    limit: number;
    windowSeconds: number;
    retryAfterSeconds: number;
  };
}

export interface ExternalServiceError extends BaseError {
  code: "EXTERNAL_SERVICE_ERROR";
  details?: {
    service: string;
    operation: string;
    statusCode?: number;
    retryable: boolean;
  };
}

export interface InternalError extends BaseError {
  code: "INTERNAL_ERROR";
  details?: {
    component: string;
    operation: string;
  };
}

export interface TimeoutError extends BaseError {
  code: "TIMEOUT_ERROR";
  details?: {
    timeoutMs: number;
    operation: string;
  };
}

export interface ThrottlingError extends BaseError {
  code: "THROTTLING_ERROR";
  details?: {
    service: string;
    retryAfterMs: number;
  };
}

// Union type for all error types
export type MangaPlatformError =
  | ValidationError
  | AuthenticationError
  | AuthorizationError
  | NotFoundError
  | ConflictError
  | RateLimitError
  | ExternalServiceError
  | InternalError
  | TimeoutError
  | ThrottlingError;

// Error Utility Functions
export class ErrorUtils {
  /**
   * Creates a standardized error object
   */
  static createError(
    code: string,
    message: string,
    details?: any,
    requestId?: string
  ): BaseError {
    return {
      code,
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
      stack:
        process.env.NODE_ENV === "development" ? new Error().stack : undefined,
    };
  }

  /**
   * Creates a validation error
   */
  static createValidationError(
    message: string,
    fieldErrors: Array<{ field: string; value: any; constraint: string }>,
    requestId?: string
  ): ValidationError {
    return {
      code: "VALIDATION_ERROR",
      message,
      details: fieldErrors,
      requestId,
      timestamp: new Date().toISOString(),
      stack:
        process.env.NODE_ENV === "development" ? new Error().stack : undefined,
    };
  }

  /**
   * Creates an API error response
   */
  static createApiErrorResponse(
    error: MangaPlatformError,
    statusCode: HttpStatusCode
  ): ApiErrorResponse {
    return {
      error,
      statusCode,
    };
  }

  /**
   * Determines if an error is retryable
   */
  static isRetryableError(error: MangaPlatformError): boolean {
    switch (error.code) {
      case "TIMEOUT_ERROR":
      case "THROTTLING_ERROR":
      case "INTERNAL_ERROR":
        return true;
      case "EXTERNAL_SERVICE_ERROR":
        return error.details?.retryable === true;
      default:
        return false;
    }
  }

  /**
   * Gets the appropriate HTTP status code for an error
   */
  static getHttpStatusCode(error: MangaPlatformError): HttpStatusCode {
    switch (error.code) {
      case "VALIDATION_ERROR":
        return HttpStatusCode.BAD_REQUEST;
      case "AUTHENTICATION_ERROR":
        return HttpStatusCode.UNAUTHORIZED;
      case "AUTHORIZATION_ERROR":
        return HttpStatusCode.FORBIDDEN;
      case "NOT_FOUND_ERROR":
        return HttpStatusCode.NOT_FOUND;
      case "CONFLICT_ERROR":
        return HttpStatusCode.CONFLICT;
      case "RATE_LIMIT_ERROR":
        return HttpStatusCode.TOO_MANY_REQUESTS;
      case "TIMEOUT_ERROR":
        return HttpStatusCode.GATEWAY_TIMEOUT;
      case "THROTTLING_ERROR":
        return HttpStatusCode.SERVICE_UNAVAILABLE;
      case "EXTERNAL_SERVICE_ERROR":
        return error.details?.statusCode || HttpStatusCode.BAD_GATEWAY;
      case "INTERNAL_ERROR":
      default:
        return HttpStatusCode.INTERNAL_SERVER_ERROR;
    }
  }

  /**
   * Sanitizes error details for client response (removes sensitive information)
   */
  static sanitizeErrorForClient(error: MangaPlatformError): BaseError {
    const sanitized = { ...error };

    // Remove stack trace in production
    if (process.env.NODE_ENV === "production") {
      delete sanitized.stack;
    }

    // Remove sensitive details for certain error types
    if (error.code === "INTERNAL_ERROR") {
      sanitized.details = undefined;
      sanitized.message = "An internal error occurred";
    }

    return sanitized;
  }

  /**
   * Logs error with appropriate level and context
   */
  static logError(
    error: MangaPlatformError,
    context?: Record<string, any>
  ): void {
    const logData = {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: error.requestId,
        timestamp: error.timestamp,
      },
      context,
    };

    // In a real implementation, this would use a proper logging library
    console.error("Error occurred:", JSON.stringify(logData, null, 2));
  }
}

// Retry Configuration
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs?: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterMs: 100,
};
