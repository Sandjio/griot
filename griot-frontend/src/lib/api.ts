import {
  ApiClient,
  ApiResponse,
  ApiErrorType,
  ExtendedApiError,
} from "@/types/api";
import { config } from "./config";

// Lazy load TokenManager to reduce initial bundle size
const getTokenManager = async () => {
  const { TokenManager } = await import("./auth");
  return TokenManager;
};

// Retry configuration
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

// Request timeout configuration
const REQUEST_TIMEOUT = 30000; // 30 seconds

/**
 * HTTP Client with automatic token injection, interceptors, and retry logic
 */
export class HttpClient implements ApiClient {
  private baseURL: string;
  private retryConfig: RetryConfig;

  constructor(
    baseURL: string = config.apiBaseUrl,
    retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
  ) {
    this.baseURL = baseURL.replace(/\/$/, ""); // Remove trailing slash
    this.retryConfig = retryConfig;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateDelay(attempt: number): number {
    const delay =
      this.retryConfig.baseDelay *
      Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: ExtendedApiError): boolean {
    return (
      error.retryable &&
      (error.status
        ? this.retryConfig.retryableStatuses.includes(error.status)
        : false)
    );
  }

  /**
   * Create timeout controller
   */
  private createTimeoutController(): AbortController {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    return controller;
  }

  /**
   * Get authorization headers with token injection
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const TokenManager = await getTokenManager();
    const accessToken = TokenManager.getAccessToken();

    if (!accessToken) {
      // Try to refresh tokens
      const tokens = TokenManager.retrieveTokens();
      if (tokens?.refreshToken) {
        try {
          const newTokens = await TokenManager.refreshTokens(
            tokens.refreshToken
          );
          return {
            Authorization: `Bearer ${newTokens.accessToken}`,
          };
        } catch (error) {
          // Token refresh failed, will be handled by caller
          throw new Error("Authentication required");
        }
      }
      throw new Error("Authentication required");
    }

    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  /**
   * Request interceptor - adds headers and authentication
   */
  private async requestInterceptor(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ url: string; options: RequestInit }> {
    const url = `${this.baseURL}${
      endpoint.startsWith("/") ? endpoint : `/${endpoint}`
    }`;

    // Default headers
    const defaultHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Add authentication headers
    try {
      const authHeaders = await this.getAuthHeaders();
      Object.assign(defaultHeaders, authHeaders);
    } catch {
      // Authentication will be handled by response interceptor
    }

    // Merge headers
    const headers = {
      ...defaultHeaders,
      ...((options.headers as Record<string, string>) || {}),
    };

    // Create timeout controller
    const controller = this.createTimeoutController();

    const requestOptions: RequestInit = {
      ...options,
      headers,
      signal: controller.signal,
    };

    return { url, options: requestOptions };
  }

  /**
   * Response interceptor - handles errors and token refresh
   */
  private async responseInterceptor(response: Response): Promise<Response> {
    // Handle successful responses
    if (response.ok) {
      return response;
    }

    // Handle authentication errors (401)
    if (response.status === 401) {
      // Try to refresh tokens
      const TokenManager = await getTokenManager();
      const tokens = TokenManager.retrieveTokens();
      if (tokens?.refreshToken) {
        try {
          await TokenManager.refreshTokens(tokens.refreshToken);
          // Token refreshed successfully, caller should retry the request
          const error: ExtendedApiError = {
            type: ApiErrorType.AUTHENTICATION_ERROR,
            code: "TOKEN_REFRESHED",
            message: "Token refreshed, retry request",
            status: 401,
            retryable: true,
            requestId: response.headers.get("x-request-id") || "",
            timestamp: new Date().toISOString(),
          };
          throw error;
        } catch {
          // Token refresh failed, clear tokens
          TokenManager.clearTokens();
          const error: ExtendedApiError = {
            type: ApiErrorType.AUTHENTICATION_ERROR,
            code: "AUTHENTICATION_FAILED",
            message: "Authentication failed",
            status: 401,
            retryable: false,
            requestId: response.headers.get("x-request-id") || "",
            timestamp: new Date().toISOString(),
          };
          throw error;
        }
      } else {
        // No refresh token available
        const error: ExtendedApiError = {
          type: ApiErrorType.AUTHENTICATION_ERROR,
          code: "NO_AUTH_TOKEN",
          message: "Authentication required",
          status: 401,
          retryable: false,
          requestId: response.headers.get("x-request-id") || "",
          timestamp: new Date().toISOString(),
        };
        throw error;
      }
    }

    // Parse error response
    let errorData: Record<string, unknown> = {};
    try {
      errorData = await response.json();
    } catch {
      // Response is not JSON, use default error
    }

    // Map HTTP status to error type
    let errorType: ApiErrorType;
    let retryable = false;

    switch (response.status) {
      case 400:
        errorType = ApiErrorType.VALIDATION_ERROR;
        break;
      case 403:
        errorType = ApiErrorType.AUTHORIZATION_ERROR;
        break;
      case 408:
        errorType = ApiErrorType.TIMEOUT_ERROR;
        retryable = true;
        break;
      case 429:
        errorType = ApiErrorType.NETWORK_ERROR;
        retryable = true;
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        errorType = ApiErrorType.SERVER_ERROR;
        retryable = true;
        break;
      default:
        errorType = ApiErrorType.UNKNOWN_ERROR;
        retryable = response.status >= 500;
    }

    const error: ExtendedApiError = {
      type: errorType,
      code: (errorData.code as string) || `HTTP_${response.status}`,
      message:
        (errorData.message as string) ||
        response.statusText ||
        "Request failed",
      details: errorData.details,
      status: response.status,
      retryable,
      requestId:
        response.headers.get("x-request-id") ||
        (errorData.requestId as string) ||
        "",
      timestamp: (errorData.timestamp as string) || new Date().toISOString(),
    };

    throw error;
  }

  /**
   * Make HTTP request with retry logic
   */
  protected async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    let lastError: ExtendedApiError | null = null;

    for (
      let attempt = 1;
      attempt <= this.retryConfig.maxRetries + 1;
      attempt++
    ) {
      try {
        // Apply request interceptor
        const { url, options: requestOptions } = await this.requestInterceptor(
          endpoint,
          options
        );

        // Make the request
        const response = await fetch(url, requestOptions);

        // Apply response interceptor
        const processedResponse = await this.responseInterceptor(response);

        // Parse successful response
        const data = await processedResponse.json();

        // Handle API response format
        if (data && typeof data === "object" && "success" in data) {
          const apiResponse = data as ApiResponse<T>;
          if (apiResponse.success) {
            return apiResponse.data;
          } else {
            // API returned success: false
            const error: ExtendedApiError = {
              type: ApiErrorType.SERVER_ERROR,
              code: "API_ERROR",
              message: apiResponse.message || "API request failed",
              status: response.status,
              retryable: false,
              requestId: apiResponse.requestId || "",
              timestamp: apiResponse.timestamp || new Date().toISOString(),
            };
            throw error;
          }
        }

        // Return raw data if not in API response format
        return data as T;
      } catch (error) {
        // Handle AbortError (timeout)
        if (error instanceof Error && error.name === "AbortError") {
          lastError = {
            type: ApiErrorType.TIMEOUT_ERROR,
            code: "REQUEST_TIMEOUT",
            message: "Request timed out",
            status: 408,
            retryable: true,
            requestId: "",
            timestamp: new Date().toISOString(),
          };
        }
        // Handle network errors
        else if (
          error instanceof TypeError &&
          error.message.includes("fetch")
        ) {
          lastError = {
            type: ApiErrorType.NETWORK_ERROR,
            code: "NETWORK_ERROR",
            message: "Network request failed",
            retryable: true,
            requestId: "",
            timestamp: new Date().toISOString(),
          };
        }
        // Handle our custom API errors
        else if (error && typeof error === "object" && "type" in error) {
          lastError = error as ExtendedApiError;
        }
        // Handle unknown errors
        else {
          lastError = {
            type: ApiErrorType.UNKNOWN_ERROR,
            code: "UNKNOWN_ERROR",
            message:
              error instanceof Error ? error.message : "Unknown error occurred",
            retryable: false,
            requestId: "",
            timestamp: new Date().toISOString(),
          };
        }

        // Check if we should retry
        const shouldRetry =
          attempt <= this.retryConfig.maxRetries &&
          this.isRetryableError(lastError);

        if (!shouldRetry) {
          throw lastError;
        }

        // Wait before retrying (exponential backoff)
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    // This should never be reached, but just in case
    throw lastError || new Error("Request failed after all retries");
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string): Promise<T> {
    return this.makeRequest<T>(endpoint, {
      method: "GET",
    });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data: unknown): Promise<T> {
    return this.makeRequest<T>(endpoint, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data: unknown): Promise<T> {
    return this.makeRequest<T>(endpoint, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string): Promise<T> {
    return this.makeRequest<T>(endpoint, {
      method: "DELETE",
    });
  }
}

/**
 * Error mapping and user-friendly message transformation
 */
export class ApiErrorHandler {
  /**
   * Map API error codes to user-friendly messages
   */
  private static readonly ERROR_MESSAGES: Record<string, string> = {
    // Authentication errors
    AUTHENTICATION_FAILED: "Please log in to continue",
    TOKEN_EXPIRED: "Your session has expired. Please log in again",
    NO_AUTH_TOKEN: "Please log in to access this feature",
    INVALID_TOKEN: "Your session is invalid. Please log in again",

    // Authorization errors
    INSUFFICIENT_PERMISSIONS:
      "You don't have permission to perform this action",
    ACCESS_DENIED:
      "Access denied. Please contact support if you believe this is an error",

    // Validation errors
    VALIDATION_ERROR: "Please check your input and try again",
    INVALID_REQUEST: "The request contains invalid data",
    MISSING_REQUIRED_FIELD: "Please fill in all required fields",
    INVALID_EMAIL: "Please enter a valid email address",
    INVALID_FORMAT: "Please check the format of your input",

    // Server errors
    INTERNAL_SERVER_ERROR:
      "Something went wrong on our end. Please try again later",
    SERVICE_UNAVAILABLE:
      "The service is temporarily unavailable. Please try again later",
    DATABASE_ERROR:
      "We're experiencing technical difficulties. Please try again later",

    // Network errors
    NETWORK_ERROR: "Please check your internet connection and try again",
    REQUEST_TIMEOUT: "The request took too long. Please try again",
    CONNECTION_FAILED: "Unable to connect to the server. Please try again",

    // Rate limiting
    RATE_LIMIT_EXCEEDED:
      "Too many requests. Please wait a moment and try again",
    QUOTA_EXCEEDED: "You've reached your usage limit. Please try again later",

    // Resource errors
    NOT_FOUND: "The requested resource was not found",
    RESOURCE_CONFLICT: "This action conflicts with existing data",
    RESOURCE_LOCKED: "This resource is currently being used by another process",

    // Default fallbacks
    UNKNOWN_ERROR: "An unexpected error occurred. Please try again",
  };

  /**
   * Get user-friendly error message
   */
  static getUserFriendlyMessage(error: ExtendedApiError): string {
    // Check for specific error code mapping
    if (this.ERROR_MESSAGES[error.code]) {
      return this.ERROR_MESSAGES[error.code];
    }

    // Check for error type mapping
    switch (error.type) {
      case ApiErrorType.AUTHENTICATION_ERROR:
        return "Please log in to continue";
      case ApiErrorType.AUTHORIZATION_ERROR:
        return "You don't have permission to perform this action";
      case ApiErrorType.VALIDATION_ERROR:
        return "Please check your input and try again";
      case ApiErrorType.NETWORK_ERROR:
        return "Please check your internet connection and try again";
      case ApiErrorType.TIMEOUT_ERROR:
        return "The request took too long. Please try again";
      case ApiErrorType.SERVER_ERROR:
        return "Something went wrong on our end. Please try again later";
      default:
        return (
          error.message || "An unexpected error occurred. Please try again"
        );
    }
  }

  /**
   * Check if error should trigger logout
   */
  static shouldTriggerLogout(error: ExtendedApiError): boolean {
    return (
      error.type === ApiErrorType.AUTHENTICATION_ERROR &&
      ["AUTHENTICATION_FAILED", "INVALID_TOKEN", "TOKEN_EXPIRED"].includes(
        error.code
      )
    );
  }

  /**
   * Check if error should show retry option
   */
  static shouldShowRetry(error: ExtendedApiError): boolean {
    return (
      error.retryable ||
      [
        ApiErrorType.NETWORK_ERROR,
        ApiErrorType.TIMEOUT_ERROR,
        ApiErrorType.SERVER_ERROR,
      ].includes(error.type)
    );
  }

  /**
   * Get error severity level
   */
  static getErrorSeverity(
    error: ExtendedApiError
  ): "low" | "medium" | "high" | "critical" {
    switch (error.type) {
      case ApiErrorType.VALIDATION_ERROR:
        return "low";
      case ApiErrorType.AUTHORIZATION_ERROR:
      case ApiErrorType.TIMEOUT_ERROR:
        return "medium";
      case ApiErrorType.AUTHENTICATION_ERROR:
      case ApiErrorType.SERVER_ERROR:
        return "high";
      case ApiErrorType.NETWORK_ERROR:
        return error.status === 429 ? "medium" : "high";
      default:
        return "medium";
    }
  }

  /**
   * Create a standardized error object for UI consumption
   */
  static createUIError(error: ExtendedApiError): {
    message: string;
    code: string;
    severity: "low" | "medium" | "high" | "critical";
    retryable: boolean;
    shouldLogout: boolean;
    requestId: string;
  } {
    return {
      message: this.getUserFriendlyMessage(error),
      code: error.code,
      severity: this.getErrorSeverity(error),
      retryable: this.shouldShowRetry(error),
      shouldLogout: this.shouldTriggerLogout(error),
      requestId: error.requestId,
    };
  }
}

/**
 * Enhanced HTTP Client with comprehensive error handling
 */
export class EnhancedHttpClient extends HttpClient {
  /**
   * Enhanced request method with automatic token refresh retry
   */
  protected async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      return await super.makeRequest<T>(endpoint, options);
    } catch (error) {
      if (error && typeof error === "object" && "type" in error) {
        const apiError = error as ExtendedApiError;

        // Handle automatic token refresh on 401 with TOKEN_REFRESHED code
        if (
          apiError.type === ApiErrorType.AUTHENTICATION_ERROR &&
          apiError.code === "TOKEN_REFRESHED"
        ) {
          // Token was refreshed, retry the original request once
          try {
            return await super.makeRequest<T>(endpoint, options);
          } catch (retryError) {
            // If retry fails, throw the retry error
            throw retryError;
          }
        }
      }

      // Re-throw the error for handling by the caller
      throw error;
    }
  }

  /**
   * GET request with enhanced error handling
   */
  async get<T>(endpoint: string): Promise<T> {
    try {
      return await this.makeRequest<T>(endpoint, { method: "GET" });
    } catch (error) {
      throw this.enhanceError(error as ExtendedApiError, "GET", endpoint);
    }
  }

  /**
   * POST request with enhanced error handling
   */
  async post<T>(endpoint: string, data: unknown): Promise<T> {
    try {
      return await this.makeRequest<T>(endpoint, {
        method: "POST",
        body: JSON.stringify(data),
      });
    } catch (error) {
      throw this.enhanceError(
        error as ExtendedApiError,
        "POST",
        endpoint,
        data
      );
    }
  }

  /**
   * PUT request with enhanced error handling
   */
  async put<T>(endpoint: string, data: unknown): Promise<T> {
    try {
      return await this.makeRequest<T>(endpoint, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    } catch (error) {
      throw this.enhanceError(error as ExtendedApiError, "PUT", endpoint, data);
    }
  }

  /**
   * DELETE request with enhanced error handling
   */
  async delete<T>(endpoint: string): Promise<T> {
    try {
      return await this.makeRequest<T>(endpoint, { method: "DELETE" });
    } catch (error) {
      throw this.enhanceError(error as ExtendedApiError, "DELETE", endpoint);
    }
  }

  /**
   * Enhance error with additional context
   */
  private enhanceError(
    error: ExtendedApiError,
    method: string,
    endpoint: string,
    data?: unknown
  ): ExtendedApiError {
    return {
      ...error,
      details: {
        ...(error.details && typeof error.details === "object"
          ? error.details
          : {}),
        method,
        endpoint,
        ...(data && typeof data === "object" ? { requestData: data } : {}),
      },
    };
  }
}

/**
 * API service wrapper with error handling and user feedback
 */
export class ApiService {
  private client: EnhancedHttpClient;

  constructor(client?: EnhancedHttpClient) {
    this.client = client || new EnhancedHttpClient();
  }

  /**
   * Execute API request with comprehensive error handling
   */
  async execute<T>(
    operation: () => Promise<T>,
    context?: string
  ): Promise<{
    success: boolean;
    data?: T;
    error?: {
      message: string;
      code: string;
      severity: "low" | "medium" | "high" | "critical";
      retryable: boolean;
      shouldLogout: boolean;
      requestId: string;
    };
  }> {
    try {
      const data = await operation();
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error(`API Error${context ? ` in ${context}` : ""}:`, error);

      if (error && typeof error === "object" && "type" in error) {
        const apiError = error as ExtendedApiError;
        return {
          success: false,
          error: ApiErrorHandler.createUIError(apiError),
        };
      }

      // Handle unexpected errors
      const fallbackError: ExtendedApiError = {
        type: ApiErrorType.UNKNOWN_ERROR,
        code: "UNEXPECTED_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
        status: 500,
        retryable: false,
        requestId: "",
        timestamp: new Date().toISOString(),
      };

      return {
        success: false,
        error: ApiErrorHandler.createUIError(fallbackError),
      };
    }
  }

  /**
   * GET request with error handling
   */
  async get<T>(endpoint: string, context?: string) {
    return this.execute(() => this.client.get<T>(endpoint), context);
  }

  /**
   * POST request with error handling
   */
  async post<T>(endpoint: string, data: unknown, context?: string) {
    return this.execute(() => this.client.post<T>(endpoint, data), context);
  }

  /**
   * PUT request with error handling
   */
  async put<T>(endpoint: string, data: unknown, context?: string) {
    return this.execute(() => this.client.put<T>(endpoint, data), context);
  }

  /**
   * DELETE request with error handling
   */
  async delete<T>(endpoint: string, context?: string) {
    return this.execute(() => this.client.delete<T>(endpoint), context);
  }
}

// Default API client instances
export const apiClient = new EnhancedHttpClient();
export const apiService = new ApiService(apiClient);

// Export for testing and custom configurations
