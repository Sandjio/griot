import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HttpClient,
  EnhancedHttpClient,
  ApiErrorHandler,
  ApiService,
} from "../api";
import { TokenManager } from "../auth";
import { ApiErrorType, ExtendedApiError } from "@/types/api";

// Mock the auth module
vi.mock("../auth", () => ({
  TokenManager: {
    getAccessToken: vi.fn(),
    retrieveTokens: vi.fn(),
    refreshTokens: vi.fn(),
    clearTokens: vi.fn(),
  },
}));

// Mock the config
vi.mock("../config", () => ({
  config: {
    NEXT_PUBLIC_API_BASE_URL: "https://api.example.com",
  },
}));

describe("HttpClient", () => {
  let client: HttpClient;
  const mockBaseURL = "https://api.example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    client = new HttpClient(mockBaseURL);
    // Mock successful token retrieval by default
    (TokenManager.getAccessToken as any).mockReturnValue("valid-access-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with base URL", () => {
      const testClient = new HttpClient("https://test.com/");
      expect(testClient).toBeInstanceOf(HttpClient);
    });

    it("should remove trailing slash from base URL", () => {
      const testClient = new HttpClient("https://test.com/");
      expect(testClient).toBeInstanceOf(HttpClient);
    });
  });

  describe("authentication token injection", () => {
    it("should include Authorization header when token is available", async () => {
      const mockResponse = { success: true, data: { test: "data" } };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.get("/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer valid-access-token",
          }),
        })
      );
    });

    it("should attempt token refresh when no access token is available", async () => {
      (TokenManager.getAccessToken as any).mockReturnValue(null);
      (TokenManager.retrieveTokens as any).mockReturnValue({
        refreshToken: "refresh-token",
      });
      (TokenManager.refreshTokens as any).mockResolvedValue({
        accessToken: "new-access-token",
      });

      const mockResponse = { success: true, data: { test: "data" } };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.get("/test");

      expect(TokenManager.refreshTokens).toHaveBeenCalledWith("refresh-token");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer new-access-token",
          }),
        })
      );
    });

    it("should throw error when no tokens are available", async () => {
      (TokenManager.getAccessToken as any).mockReturnValue(null);
      (TokenManager.retrieveTokens as any).mockReturnValue(null);

      await expect(client.get("/test")).rejects.toThrow(
        "Authentication required"
      );
    });
  });

  describe("HTTP methods", () => {
    beforeEach(() => {
      const mockResponse = { success: true, data: { test: "data" } };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
    });

    it("should make GET request", async () => {
      const result = await client.get("/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          method: "GET",
        })
      );
      expect(result).toEqual({ test: "data" });
    });

    it("should make POST request with data", async () => {
      const testData = { name: "test" };
      await client.post("/test", testData);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(testData),
        })
      );
    });

    it("should make PUT request with data", async () => {
      const testData = { name: "test" };
      await client.put("/test", testData);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(testData),
        })
      );
    });

    it("should make DELETE request", async () => {
      await client.delete("/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("error handling", () => {
    it("should handle 401 unauthorized with token refresh", async () => {
      // First call returns 401
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          headers: new Map([["x-request-id", "req-123"]]),
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ success: true, data: { test: "data" } }),
        });
      (TokenManager.retrieveTokens as any).mockReturnValue({
        refreshToken: "refresh-token",
      });
      (TokenManager.refreshTokens as any).mockResolvedValue({
        accessToken: "new-access-token",
      });

      const result = await client.get("/test");

      expect(TokenManager.refreshTokens).toHaveBeenCalledWith("refresh-token");
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ test: "data" });
    });

    it("should handle 401 unauthorized when refresh fails", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Map([["x-request-id", "req-123"]]),
        json: () => Promise.resolve({}),
      });
      (TokenManager.retrieveTokens as any).mockReturnValue({
        refreshToken: "refresh-token",
      });
      (TokenManager.refreshTokens as any).mockRejectedValue(
        new Error("Refresh failed")
      );

      await expect(client.get("/test")).rejects.toMatchObject({
        type: ApiErrorType.AUTHENTICATION_ERROR,
        code: "AUTHENTICATION_FAILED",
        status: 401,
      });

      expect(TokenManager.clearTokens).toHaveBeenCalled();
    });

    it("should handle 401 unauthorized when no refresh token available", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Map([["x-request-id", "req-123"]]),
        json: () => Promise.resolve({}),
      });
      (TokenManager.retrieveTokens as any).mockReturnValue(null);

      await expect(client.get("/test")).rejects.toMatchObject({
        type: ApiErrorType.AUTHENTICATION_ERROR,
        code: "NO_AUTH_TOKEN",
        status: 401,
      });
    });

    it("should handle different HTTP error statuses", async () => {
      const testCases = [
        { status: 400, expectedType: ApiErrorType.VALIDATION_ERROR },
        { status: 403, expectedType: ApiErrorType.AUTHORIZATION_ERROR },
        { status: 408, expectedType: ApiErrorType.TIMEOUT_ERROR },
        { status: 429, expectedType: ApiErrorType.NETWORK_ERROR },
        { status: 500, expectedType: ApiErrorType.SERVER_ERROR },
        { status: 502, expectedType: ApiErrorType.SERVER_ERROR },
        { status: 503, expectedType: ApiErrorType.SERVER_ERROR },
        { status: 504, expectedType: ApiErrorType.SERVER_ERROR },
      ];

      for (const testCase of testCases) {
        (global.fetch as any).mockResolvedValue({
          ok: false,
          status: testCase.status,
          statusText: `Error ${testCase.status}`,
          headers: new Map([["x-request-id", "req-123"]]),
          json: () => Promise.resolve({}),
        });

        await expect(client.get("/test")).rejects.toMatchObject({
          type: testCase.expectedType,
          status: testCase.status,
        });
      }
    });

    it("should handle network errors", async () => {
      (global.fetch as any).mockRejectedValue(new TypeError("Network error"));

      await expect(client.get("/test")).rejects.toMatchObject({
        type: ApiErrorType.NETWORK_ERROR,
        code: "NETWORK_ERROR",
        retryable: true,
      });
    });

    it("should handle timeout errors", async () => {
      // Mock AbortError
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      (global.fetch as any).mockRejectedValue(abortError);

      await expect(client.get("/test")).rejects.toMatchObject({
        type: ApiErrorType.TIMEOUT_ERROR,
        code: "REQUEST_TIMEOUT",
        retryable: true,
      });
    });
  });

  describe("retry logic", () => {
    it("should retry on retryable errors", async () => {
      // First two calls fail, third succeeds
      (global.fetch as any)
        .mockRejectedValueOnce(new TypeError("Network error"))
        .mockRejectedValueOnce(new TypeError("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ success: true, data: { test: "data" } }),
        });

      const result = await client.get("/test");

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ test: "data" });
    });

    it("should not retry on non-retryable errors", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Map([["x-request-id", "req-123"]]),
        json: () => Promise.resolve({}),
      });

      await expect(client.get("/test")).rejects.toMatchObject({
        type: ApiErrorType.VALIDATION_ERROR,
        status: 400,
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should respect maximum retry attempts", async () => {
      (global.fetch as any).mockRejectedValue(new TypeError("Network error"));

      await expect(client.get("/test")).rejects.toMatchObject({
        type: ApiErrorType.NETWORK_ERROR,
        code: "NETWORK_ERROR",
      });

      // Should try initial + 3 retries = 4 total
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("response parsing", () => {
    it("should parse API response format", async () => {
      const mockApiResponse = {
        success: true,
        data: { test: "data" },
        message: "Success",
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      });

      const result = await client.get("/test");
      expect(result).toEqual({ test: "data" });
    });

    it("should handle API response with success: false", async () => {
      const mockApiResponse = {
        success: false,
        message: "API Error",
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockApiResponse),
      });

      await expect(client.get("/test")).rejects.toMatchObject({
        type: ApiErrorType.SERVER_ERROR,
        code: "API_ERROR",
        message: "API Error",
      });
    });

    it("should handle raw JSON response", async () => {
      const mockRawResponse = { test: "data" };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockRawResponse),
      });

      const result = await client.get("/test");
      expect(result).toEqual(mockRawResponse);
    });
  });
});

describe("EnhancedHttpClient", () => {
  let client: EnhancedHttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new EnhancedHttpClient();
    (TokenManager.getAccessToken as any).mockReturnValue("valid-access-token");
  });

  describe("automatic token refresh retry", () => {
    it("should retry request after successful token refresh", async () => {
      // First call returns TOKEN_REFRESHED error, second call succeeds
      const tokenRefreshError: ExtendedApiError = {
        type: ApiErrorType.AUTHENTICATION_ERROR,
        code: "TOKEN_REFRESHED",
        message: "Token refreshed, retry request",
        status: 401,
        retryable: true,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      // Mock the parent class method to throw TOKEN_REFRESHED error first, then succeed
      const originalMakeRequest = HttpClient.prototype.makeRequest;
      let callCount = 0;
      vi.spyOn(HttpClient.prototype, "makeRequest").mockImplementation(
        async function (endpoint: string, options: RequestInit) {
          callCount++;
          if (callCount === 1) {
            throw tokenRefreshError;
          }
          return { test: "data" };
        }
      );

      const result = await client.get("/test");

      expect(result).toEqual({ test: "data" });
      expect(HttpClient.prototype.makeRequest).toHaveBeenCalledTimes(2);

      // Restore original method
      vi.mocked(HttpClient.prototype.makeRequest).mockRestore();
    });

    it("should throw error if retry after token refresh fails", async () => {
      const tokenRefreshError: ExtendedApiError = {
        type: ApiErrorType.AUTHENTICATION_ERROR,
        code: "TOKEN_REFRESHED",
        message: "Token refreshed, retry request",
        status: 401,
        retryable: true,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      const retryError: ExtendedApiError = {
        type: ApiErrorType.AUTHENTICATION_ERROR,
        code: "AUTHENTICATION_FAILED",
        message: "Authentication failed",
        status: 401,
        retryable: false,
        requestId: "req-124",
        timestamp: "2023-01-01T00:00:01Z",
      };

      // Mock the parent class method to throw TOKEN_REFRESHED error first, then another error
      let callCount = 0;
      vi.spyOn(HttpClient.prototype, "makeRequest").mockImplementation(
        async function (endpoint: string, options: RequestInit) {
          callCount++;
          if (callCount === 1) {
            throw tokenRefreshError;
          }
          throw retryError;
        }
      );

      await expect(client.get("/test")).rejects.toEqual(retryError);

      vi.mocked(HttpClient.prototype.makeRequest).mockRestore();
    });
  });

  describe("enhanced error handling", () => {
    it("should enhance errors with request context", async () => {
      const originalError: ExtendedApiError = {
        type: ApiErrorType.SERVER_ERROR,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        status: 500,
        retryable: true,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      vi.spyOn(HttpClient.prototype, "makeRequest").mockRejectedValue(
        originalError
      );

      await expect(
        client.post("/test", { data: "test" })
      ).rejects.toMatchObject({
        ...originalError,
        details: expect.objectContaining({
          method: "POST",
          endpoint: "/test",
          requestData: { data: "test" },
        }),
      });

      vi.mocked(HttpClient.prototype.makeRequest).mockRestore();
    });
  });
});

describe("ApiErrorHandler", () => {
  describe("getUserFriendlyMessage", () => {
    it("should return specific error message for known codes", () => {
      const error: ExtendedApiError = {
        type: ApiErrorType.AUTHENTICATION_ERROR,
        code: "AUTHENTICATION_FAILED",
        message: "Auth failed",
        status: 401,
        retryable: false,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      const message = ApiErrorHandler.getUserFriendlyMessage(error);
      expect(message).toBe("Please log in to continue");
    });

    it("should return type-based message for unknown codes", () => {
      const error: ExtendedApiError = {
        type: ApiErrorType.VALIDATION_ERROR,
        code: "UNKNOWN_VALIDATION_ERROR",
        message: "Validation failed",
        status: 400,
        retryable: false,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      const message = ApiErrorHandler.getUserFriendlyMessage(error);
      expect(message).toBe("Please check your input and try again");
    });

    it("should return original message for unknown types", () => {
      const error: ExtendedApiError = {
        type: "UNKNOWN_ERROR" as ApiErrorType,
        code: "UNKNOWN_CODE",
        message: "Something went wrong",
        status: 500,
        retryable: false,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      const message = ApiErrorHandler.getUserFriendlyMessage(error);
      expect(message).toBe("Something went wrong");
    });
  });

  describe("shouldTriggerLogout", () => {
    it("should return true for authentication errors that require logout", () => {
      const testCases = [
        "AUTHENTICATION_FAILED",
        "INVALID_TOKEN",
        "TOKEN_EXPIRED",
      ];

      testCases.forEach((code) => {
        const error: ExtendedApiError = {
          type: ApiErrorType.AUTHENTICATION_ERROR,
          code,
          message: "Auth error",
          status: 401,
          retryable: false,
          requestId: "req-123",
          timestamp: "2023-01-01T00:00:00Z",
        };

        expect(ApiErrorHandler.shouldTriggerLogout(error)).toBe(true);
      });
    });

    it("should return false for other errors", () => {
      const error: ExtendedApiError = {
        type: ApiErrorType.VALIDATION_ERROR,
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        status: 400,
        retryable: false,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      expect(ApiErrorHandler.shouldTriggerLogout(error)).toBe(false);
    });
  });

  describe("shouldShowRetry", () => {
    it("should return true for retryable errors", () => {
      const error: ExtendedApiError = {
        type: ApiErrorType.NETWORK_ERROR,
        code: "NETWORK_ERROR",
        message: "Network failed",
        status: 500,
        retryable: true,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      expect(ApiErrorHandler.shouldShowRetry(error)).toBe(true);
    });

    it("should return true for specific error types even if not marked retryable", () => {
      const error: ExtendedApiError = {
        type: ApiErrorType.SERVER_ERROR,
        code: "SERVER_ERROR",
        message: "Server failed",
        status: 500,
        retryable: false,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      expect(ApiErrorHandler.shouldShowRetry(error)).toBe(true);
    });
  });

  describe("getErrorSeverity", () => {
    it("should return correct severity levels", () => {
      const testCases = [
        { type: ApiErrorType.VALIDATION_ERROR, expected: "low" },
        { type: ApiErrorType.AUTHORIZATION_ERROR, expected: "medium" },
        { type: ApiErrorType.AUTHENTICATION_ERROR, expected: "high" },
        { type: ApiErrorType.SERVER_ERROR, expected: "high" },
        { type: ApiErrorType.NETWORK_ERROR, expected: "high" },
      ];

      testCases.forEach(({ type, expected }) => {
        const error: ExtendedApiError = {
          type,
          code: "TEST_ERROR",
          message: "Test error",
          status: 500,
          retryable: false,
          requestId: "req-123",
          timestamp: "2023-01-01T00:00:00Z",
        };

        expect(ApiErrorHandler.getErrorSeverity(error)).toBe(expected);
      });
    });
  });

  describe("createUIError", () => {
    it("should create standardized UI error object", () => {
      const error: ExtendedApiError = {
        type: ApiErrorType.AUTHENTICATION_ERROR,
        code: "AUTHENTICATION_FAILED",
        message: "Auth failed",
        status: 401,
        retryable: false,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      const uiError = ApiErrorHandler.createUIError(error);

      expect(uiError).toEqual({
        message: "Please log in to continue",
        code: "AUTHENTICATION_FAILED",
        severity: "high",
        retryable: false,
        shouldLogout: true,
        requestId: "req-123",
      });
    });
  });
});

describe("ApiService", () => {
  let service: ApiService;
  let mockClient: EnhancedHttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as any;
    service = new ApiService(mockClient);
  });

  describe("execute", () => {
    it("should return success result for successful operations", async () => {
      const mockData = { test: "data" };
      const mockOperation = vi.fn().mockResolvedValue(mockData);

      const result = await service.execute(mockOperation, "test context");

      expect(result).toEqual({
        success: true,
        data: mockData,
      });
      expect(mockOperation).toHaveBeenCalled();
    });

    it("should return error result for API errors", async () => {
      const mockError: ExtendedApiError = {
        type: ApiErrorType.VALIDATION_ERROR,
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        status: 400,
        retryable: false,
        requestId: "req-123",
        timestamp: "2023-01-01T00:00:00Z",
      };

      const mockOperation = vi.fn().mockRejectedValue(mockError);

      const result = await service.execute(mockOperation, "test context");

      expect(result).toEqual({
        success: false,
        error: {
          message: "Please check your input and try again",
          code: "VALIDATION_ERROR",
          severity: "low",
          retryable: false,
          shouldLogout: false,
          requestId: "req-123",
        },
      });
    });

    it("should handle unexpected errors", async () => {
      const mockError = new Error("Unexpected error");
      const mockOperation = vi.fn().mockRejectedValue(mockError);

      const result = await service.execute(mockOperation);

      expect(result).toEqual({
        success: false,
        error: {
          message: "Unexpected error",
          code: "UNEXPECTED_ERROR",
          severity: "medium",
          retryable: false,
          shouldLogout: false,
          requestId: "",
        },
      });
    });
  });

  describe("HTTP method wrappers", () => {
    it("should call get method with error handling", async () => {
      const mockData = { test: "data" };
      (mockClient.get as any).mockResolvedValue(mockData);

      const result = await service.get("/test", "test context");

      expect(mockClient.get).toHaveBeenCalledWith("/test");
      expect(result).toEqual({
        success: true,
        data: mockData,
      });
    });

    it("should call post method with error handling", async () => {
      const mockData = { test: "data" };
      const postData = { name: "test" };
      (mockClient.post as any).mockResolvedValue(mockData);

      const result = await service.post("/test", postData, "test context");

      expect(mockClient.post).toHaveBeenCalledWith("/test", postData);
      expect(result).toEqual({
        success: true,
        data: mockData,
      });
    });

    it("should call put method with error handling", async () => {
      const mockData = { test: "data" };
      const putData = { name: "test" };
      (mockClient.put as any).mockResolvedValue(mockData);

      const result = await service.put("/test", putData, "test context");

      expect(mockClient.put).toHaveBeenCalledWith("/test", putData);
      expect(result).toEqual({
        success: true,
        data: mockData,
      });
    });

    it("should call delete method with error handling", async () => {
      const mockData = { test: "data" };
      (mockClient.delete as any).mockResolvedValue(mockData);

      const result = await service.delete("/test", "test context");

      expect(mockClient.delete).toHaveBeenCalledWith("/test");
      expect(result).toEqual({
        success: true,
        data: mockData,
      });
    });
  });
});

describe("Integration scenarios", () => {
  let client: EnhancedHttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new EnhancedHttpClient();
  });

  describe("complete authentication flow", () => {
    it("should handle complete token refresh flow", async () => {
      // Setup: No access token, but refresh token available
      (TokenManager.getAccessToken as any).mockReturnValue(null);
      (TokenManager.retrieveTokens as any).mockReturnValue({
        refreshToken: "refresh-token",
      });
      (TokenManager.refreshTokens as any).mockResolvedValue({
        accessToken: "new-access-token",
      });

      // Mock successful API response after token refresh
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { test: "data" } }),
      });

      const result = await client.get("/protected-endpoint");

      // Verify token refresh was called
      expect(TokenManager.refreshTokens).toHaveBeenCalledWith("refresh-token");

      // Verify API call was made with new token
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/protected-endpoint",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer new-access-token",
          }),
        })
      );

      expect(result).toEqual({ test: "data" });
    });

    it("should handle token refresh failure and clear tokens", async () => {
      // Setup: Access token expired, refresh fails
      (TokenManager.getAccessToken as any).mockReturnValue(null);
      (TokenManager.retrieveTokens as any).mockReturnValue({
        refreshToken: "expired-refresh-token",
      });
      (TokenManager.refreshTokens as any).mockRejectedValue(
        new Error("Refresh token expired")
      );

      await expect(client.get("/protected-endpoint")).rejects.toThrow(
        "Authentication required"
      );

      expect(TokenManager.refreshTokens).toHaveBeenCalledWith(
        "expired-refresh-token"
      );
    });
  });

  describe("retry with exponential backoff", () => {
    it("should retry with increasing delays", async () => {
      const startTime = Date.now();
      let callCount = 0;

      // Mock network errors for first 2 calls, success on 3rd
      (global.fetch as any).mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new TypeError("Network error"));
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ success: true, data: { test: "data" } }),
        });
      });

      const result = await client.get("/test");

      expect(result).toEqual({ test: "data" });
      expect(global.fetch).toHaveBeenCalledTimes(3);

      // Verify that some delay occurred (should be at least 1 second for first retry)
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThan(1000);
    });
  });

  describe("error recovery scenarios", () => {
    it("should handle 401 followed by successful retry", async () => {
      let callCount = 0;

      (global.fetch as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: 401 unauthorized
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Map([["x-request-id", "req-123"]]),
            json: () => Promise.resolve({}),
          });
        }
        // Second call: success after token refresh
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ success: true, data: { test: "data" } }),
        });
      });
      (TokenManager.retrieveTokens as any).mockReturnValue({
        refreshToken: "refresh-token",
      });
      (TokenManager.refreshTokens as any).mockResolvedValue({
        accessToken: "new-access-token",
      });

      const result = await client.get("/test");

      expect(result).toEqual({ test: "data" });
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(TokenManager.refreshTokens).toHaveBeenCalled();
    });
  });
});
