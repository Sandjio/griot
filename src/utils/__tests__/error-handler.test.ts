/**
 * Tests for Error Handling Utilities
 *
 * Tests comprehensive error handling, retry logic, circuit breaker pattern,
 * and correlation ID management.
 */

import {
  CorrelationContext,
  RetryHandler,
  CircuitBreaker,
  CircuitBreakerState,
  CircuitBreakerRegistry,
  ErrorLogger,
  withErrorHandling,
  DEFAULT_RETRY_CONFIG,
  EXTERNAL_API_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from "../error-handler";
import { ErrorUtils } from "../../types/error-types";

// Mock console methods
const mockConsoleLog = jest.fn();
const mockConsoleWarn = jest.fn();
const mockConsoleError = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  console.log = mockConsoleLog;
  console.warn = mockConsoleWarn;
  console.error = mockConsoleError;

  // Clear correlation context
  CorrelationContext.clear();

  // Reset circuit breakers
  CircuitBreakerRegistry.resetAll();
});

describe("CorrelationContext", () => {
  test("should generate correlation ID when none exists", () => {
    const correlationId = CorrelationContext.getCorrelationId();
    expect(correlationId).toBeDefined();
    expect(typeof correlationId).toBe("string");
    expect(correlationId.length).toBeGreaterThan(0);
  });

  test("should return same correlation ID when called multiple times", () => {
    const correlationId1 = CorrelationContext.getCorrelationId();
    const correlationId2 = CorrelationContext.getCorrelationId();
    expect(correlationId1).toBe(correlationId2);
  });

  test("should set and get correlation ID", () => {
    const testId = "test-correlation-id";
    CorrelationContext.setCorrelationId(testId);
    expect(CorrelationContext.getCorrelationId()).toBe(testId);
  });

  test("should generate new correlation ID", () => {
    const originalId = CorrelationContext.getCorrelationId();
    const newId = CorrelationContext.generateNew();
    expect(newId).not.toBe(originalId);
    expect(CorrelationContext.getCorrelationId()).toBe(newId);
  });

  test("should clear correlation ID", () => {
    CorrelationContext.setCorrelationId("test-id");
    CorrelationContext.clear();
    const newId = CorrelationContext.getCorrelationId();
    expect(newId).not.toBe("test-id");
  });
});

describe("RetryHandler", () => {
  test("should succeed on first attempt", async () => {
    const retryHandler = new RetryHandler(DEFAULT_RETRY_CONFIG);
    const mockOperation = jest.fn().mockResolvedValue("success");

    const result = await retryHandler.execute(mockOperation, "test-operation");

    expect(result).toBe("success");
    expect(mockOperation).toHaveBeenCalledTimes(1);
  });

  test("should retry on retryable errors", async () => {
    const retryHandler = new RetryHandler({
      ...DEFAULT_RETRY_CONFIG,
      maxAttempts: 3,
      baseDelayMs: 10, // Fast for testing
      jitterMs: 0,
    });

    const mockOperation = jest
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("throttling"))
      .mockResolvedValue("success");

    const result = await retryHandler.execute(mockOperation, "test-operation");

    expect(result).toBe("success");
    expect(mockOperation).toHaveBeenCalledTimes(3);
  });

  test("should not retry on non-retryable errors", async () => {
    const retryHandler = new RetryHandler(DEFAULT_RETRY_CONFIG);
    const mockOperation = jest
      .fn()
      .mockRejectedValue(new Error("validation error"));

    await expect(
      retryHandler.execute(mockOperation, "test-operation")
    ).rejects.toThrow("validation error");

    expect(mockOperation).toHaveBeenCalledTimes(1);
  });

  test("should fail after max attempts", async () => {
    const retryHandler = new RetryHandler({
      ...DEFAULT_RETRY_CONFIG,
      maxAttempts: 2,
      baseDelayMs: 10,
      jitterMs: 0,
    });

    const mockOperation = jest.fn().mockRejectedValue(new Error("timeout"));

    await expect(
      retryHandler.execute(mockOperation, "test-operation")
    ).rejects.toThrow("timeout");

    expect(mockOperation).toHaveBeenCalledTimes(2);
  });

  test("should handle MangaPlatformError with retryable codes", async () => {
    const retryHandler = new RetryHandler({
      ...DEFAULT_RETRY_CONFIG,
      maxAttempts: 2,
      baseDelayMs: 10,
      jitterMs: 0,
    });

    const retryableError = ErrorUtils.createError(
      "TIMEOUT_ERROR",
      "Request timed out",
      {},
      "test-correlation-id"
    );

    const mockOperation = jest
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValue("success");

    const result = await retryHandler.execute(mockOperation, "test-operation");

    expect(result).toBe("success");
    expect(mockOperation).toHaveBeenCalledTimes(2);
  });
});

describe("CircuitBreaker", () => {
  test("should start in CLOSED state", () => {
    const circuitBreaker = new CircuitBreaker("test-breaker");
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(circuitBreaker.getFailureCount()).toBe(0);
  });

  test("should execute operation successfully in CLOSED state", async () => {
    const circuitBreaker = new CircuitBreaker("test-breaker");
    const mockOperation = jest.fn().mockResolvedValue("success");

    const result = await circuitBreaker.execute(mockOperation);

    expect(result).toBe("success");
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(circuitBreaker.getFailureCount()).toBe(0);
  });

  test("should open circuit after failure threshold", async () => {
    const circuitBreaker = new CircuitBreaker("test-breaker", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failureThreshold: 2,
    });

    const mockOperation = jest.fn().mockRejectedValue(new Error("test error"));

    // First failure
    await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow(
      "test error"
    );
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(circuitBreaker.getFailureCount()).toBe(1);

    // Second failure - should open circuit
    await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow(
      "test error"
    );
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    expect(circuitBreaker.getFailureCount()).toBe(2);
  });

  test("should reject requests when circuit is OPEN", async () => {
    const circuitBreaker = new CircuitBreaker("test-breaker", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failureThreshold: 1,
    });

    const mockOperation = jest.fn().mockRejectedValue(new Error("test error"));

    // Trigger circuit to open
    await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow(
      "test error"
    );
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

    // Should reject without calling operation
    const mockOperation2 = jest.fn().mockResolvedValue("success");
    await expect(circuitBreaker.execute(mockOperation2)).rejects.toThrow(
      "Circuit breaker test-breaker is OPEN"
    );
    expect(mockOperation2).not.toHaveBeenCalled();
  });

  test("should transition to HALF_OPEN after recovery timeout", async () => {
    const circuitBreaker = new CircuitBreaker("test-breaker", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failureThreshold: 1,
      recoveryTimeoutMs: 50, // Short timeout for testing
    });

    const mockOperation = jest.fn().mockRejectedValue(new Error("test error"));

    // Trigger circuit to open
    await expect(circuitBreaker.execute(mockOperation)).rejects.toThrow(
      "test error"
    );
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

    // Wait for recovery timeout
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Next call should transition to HALF_OPEN
    const mockOperation2 = jest.fn().mockResolvedValue("success");
    const result = await circuitBreaker.execute(mockOperation2);

    expect(result).toBe("success");
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  test("should reset failure count on successful operation", async () => {
    const circuitBreaker = new CircuitBreaker("test-breaker");
    const mockFailingOperation = jest
      .fn()
      .mockRejectedValue(new Error("test error"));
    const mockSuccessOperation = jest.fn().mockResolvedValue("success");

    // Cause some failures
    await expect(
      circuitBreaker.execute(mockFailingOperation)
    ).rejects.toThrow();
    expect(circuitBreaker.getFailureCount()).toBe(1);

    // Successful operation should reset failure count
    await circuitBreaker.execute(mockSuccessOperation);
    expect(circuitBreaker.getFailureCount()).toBe(0);
  });

  test("should reset circuit breaker state", () => {
    const circuitBreaker = new CircuitBreaker("test-breaker", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failureThreshold: 1,
    });

    // Manually set some state
    circuitBreaker
      .execute(() => Promise.reject(new Error("test")))
      .catch(() => {});

    // Reset should clear state
    circuitBreaker.reset();
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(circuitBreaker.getFailureCount()).toBe(0);
  });
});

describe("CircuitBreakerRegistry", () => {
  test("should create and retrieve circuit breakers", () => {
    const breaker1 = CircuitBreakerRegistry.getOrCreate("test-breaker-1");
    const breaker2 = CircuitBreakerRegistry.getOrCreate("test-breaker-1");
    const breaker3 = CircuitBreakerRegistry.getOrCreate("test-breaker-2");

    expect(breaker1).toBe(breaker2); // Same instance
    expect(breaker1).not.toBe(breaker3); // Different instance
  });

  test("should get circuit breaker status", async () => {
    const breaker = CircuitBreakerRegistry.getOrCreate("test-breaker", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failureThreshold: 1,
    });

    // Trigger failure
    await breaker
      .execute(() => Promise.reject(new Error("test")))
      .catch(() => {});

    const status = CircuitBreakerRegistry.getStatus();
    expect(status["test-breaker"]).toEqual({
      state: CircuitBreakerState.OPEN,
      failureCount: 1,
    });
  });

  test("should reset specific circuit breaker", async () => {
    const breaker = CircuitBreakerRegistry.getOrCreate("test-breaker", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failureThreshold: 1,
    });

    // Trigger failure
    await breaker
      .execute(() => Promise.reject(new Error("test")))
      .catch(() => {});
    expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);

    // Reset specific breaker
    CircuitBreakerRegistry.reset("test-breaker");
    expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  test("should reset all circuit breakers", async () => {
    const breaker1 = CircuitBreakerRegistry.getOrCreate("test-breaker-1", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failureThreshold: 1,
    });
    const breaker2 = CircuitBreakerRegistry.getOrCreate("test-breaker-2", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failureThreshold: 1,
    });

    // Trigger failures
    await breaker1
      .execute(() => Promise.reject(new Error("test")))
      .catch(() => {});
    await breaker2
      .execute(() => Promise.reject(new Error("test")))
      .catch(() => {});

    expect(breaker1.getState()).toBe(CircuitBreakerState.OPEN);
    expect(breaker2.getState()).toBe(CircuitBreakerState.OPEN);

    // Reset all
    CircuitBreakerRegistry.resetAll();
    expect(breaker1.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(breaker2.getState()).toBe(CircuitBreakerState.CLOSED);
  });
});

describe("ErrorLogger", () => {
  test("should log error with correlation ID", () => {
    CorrelationContext.setCorrelationId("test-correlation-id");
    const error = new Error("test error");
    const context = { userId: "user123" };

    ErrorLogger.logError(error, context, "TestOperation");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error occurred:",
      expect.stringContaining("test-correlation-id")
    );
  });

  test("should log warning with correlation ID", () => {
    CorrelationContext.setCorrelationId("test-correlation-id");
    const context = { userId: "user123" };

    ErrorLogger.logWarning("test warning", context, "TestOperation");

    expect(mockConsoleWarn).toHaveBeenCalledWith(
      "Warning:",
      expect.stringContaining("test-correlation-id")
    );
  });

  test("should log info with correlation ID", () => {
    CorrelationContext.setCorrelationId("test-correlation-id");
    const context = { userId: "user123" };

    ErrorLogger.logInfo("test info", context, "TestOperation");

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "Info:",
      expect.stringContaining("test-correlation-id")
    );
  });

  test("should handle MangaPlatformError", () => {
    const error = ErrorUtils.createError(
      "VALIDATION_ERROR",
      "Invalid input",
      { field: "email" },
      "test-correlation-id"
    );

    ErrorLogger.logError(error, {}, "TestOperation");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error occurred:",
      expect.stringContaining("VALIDATION_ERROR")
    );
  });
});

describe("withErrorHandling", () => {
  test("should wrap handler with error handling", async () => {
    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withErrorHandling(mockHandler, "TestHandler");

    const event = { test: "data" };
    const result = await wrappedHandler(event);

    expect(result).toBe("success");
    expect(mockHandler).toHaveBeenCalledWith(event, expect.any(String));
  });

  test("should extract correlation ID from event", async () => {
    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withErrorHandling(mockHandler, "TestHandler");

    const event = {
      requestContext: { requestId: "test-request-id" },
    };

    await wrappedHandler(event);

    expect(mockHandler).toHaveBeenCalledWith(event, "test-request-id");
  });

  test("should extract correlation ID from event detail", async () => {
    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withErrorHandling(mockHandler, "TestHandler");

    const event = {
      detail: { correlationId: "test-correlation-id" },
    };

    await wrappedHandler(event);

    expect(mockHandler).toHaveBeenCalledWith(event, "test-correlation-id");
  });

  test("should generate correlation ID if not present", async () => {
    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withErrorHandling(mockHandler, "TestHandler");

    const event = { test: "data" };
    await wrappedHandler(event);

    expect(mockHandler).toHaveBeenCalledWith(event, expect.any(String));
    const correlationId = mockHandler.mock.calls[0][1];
    expect(correlationId).toBeDefined();
    expect(typeof correlationId).toBe("string");
  });

  test("should handle errors and re-throw", async () => {
    const error = new Error("test error");
    const mockHandler = jest.fn().mockRejectedValue(error);
    const wrappedHandler = withErrorHandling(mockHandler, "TestHandler");

    const event = { test: "data" };

    await expect(wrappedHandler(event)).rejects.toThrow("test error");
    expect(mockConsoleError).toHaveBeenCalled();
  });

  test("should clear correlation context after execution", async () => {
    const mockHandler = jest.fn().mockResolvedValue("success");
    const wrappedHandler = withErrorHandling(mockHandler, "TestHandler");

    const event = { test: "data" };
    await wrappedHandler(event);

    // Correlation context should be cleared
    const newCorrelationId = CorrelationContext.getCorrelationId();
    const handlerCorrelationId = mockHandler.mock.calls[0][1];
    expect(newCorrelationId).not.toBe(handlerCorrelationId);
  });

  test("should clear correlation context even on error", async () => {
    const error = new Error("test error");
    const mockHandler = jest.fn().mockRejectedValue(error);
    const wrappedHandler = withErrorHandling(mockHandler, "TestHandler");

    const event = { test: "data" };

    await expect(wrappedHandler(event)).rejects.toThrow("test error");

    // Correlation context should still be cleared
    const newCorrelationId = CorrelationContext.getCorrelationId();
    const handlerCorrelationId = mockHandler.mock.calls[0][1];
    expect(newCorrelationId).not.toBe(handlerCorrelationId);
  });
});

describe("Integration Tests", () => {
  test("should handle complex retry scenario with circuit breaker", async () => {
    const circuitBreaker = new CircuitBreaker("integration-test", {
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      monitoringPeriodMs: 1000,
      halfOpenMaxCalls: 1,
    });

    const retryHandler = new RetryHandler({
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitterMs: 0,
      retryableErrors: ["TIMEOUT_ERROR"],
    });

    let callCount = 0;
    const mockOperation = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 4) {
        const error = ErrorUtils.createError("TIMEOUT_ERROR", "Timeout", {});
        return Promise.reject(error);
      }
      return Promise.resolve("success");
    });

    // First attempt - should retry and eventually fail
    await expect(
      circuitBreaker.execute(() => retryHandler.execute(mockOperation, "test"))
    ).rejects.toThrow();

    // Second attempt - should fail and open circuit
    await expect(
      circuitBreaker.execute(() => retryHandler.execute(mockOperation, "test"))
    ).rejects.toThrow();

    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

    // Wait for recovery
    await new Promise((resolve) => setTimeout(resolve, 110));

    // Should succeed after recovery
    const result = await circuitBreaker.execute(() =>
      retryHandler.execute(mockOperation, "test")
    );

    expect(result).toBe("success");
    expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
  });

  test("should maintain correlation ID across retry attempts", async () => {
    CorrelationContext.setCorrelationId("test-correlation-id");

    const retryHandler = new RetryHandler({
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitterMs: 0,
      retryableErrors: ["TIMEOUT_ERROR"],
    });

    let attemptCount = 0;
    const mockOperation = jest.fn().mockImplementation(() => {
      attemptCount++;
      const currentCorrelationId = CorrelationContext.getCorrelationId();
      expect(currentCorrelationId).toBe("test-correlation-id");

      if (attemptCount < 3) {
        return Promise.reject(new Error("timeout"));
      }
      return Promise.resolve("success");
    });

    const result = await retryHandler.execute(mockOperation, "test");
    expect(result).toBe("success");
    expect(attemptCount).toBe(3);
  });
});
