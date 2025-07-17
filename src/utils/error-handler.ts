/**
 * Comprehensive Error Handling Utilities
 *
 * Provides standardized error handling, retry logic, circuit breaker pattern,
 * and correlation ID management across all Lambda functions.
 *
 * Requirements: 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { v4 as uuidv4 } from "uuid";
import { MangaPlatformError, ErrorUtils } from "../types/error-types";

// Correlation ID context
export class CorrelationContext {
  private static correlationId: string | null = null;

  static setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  static getCorrelationId(): string {
    if (!this.correlationId) {
      this.correlationId = uuidv4();
    }
    return this.correlationId;
  }

  static generateNew(): string {
    this.correlationId = uuidv4();
    return this.correlationId;
  }

  static clear(): void {
    this.correlationId = null;
  }
}

// Retry configuration interface
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
  retryableErrors: string[];
}

// Default retry configurations
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterMs: 100,
  retryableErrors: [
    "TIMEOUT_ERROR",
    "THROTTLING_ERROR",
    "INTERNAL_ERROR",
    "EXTERNAL_SERVICE_ERROR",
  ],
};

export const EXTERNAL_API_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 2000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterMs: 500,
  retryableErrors: [
    "TIMEOUT_ERROR",
    "THROTTLING_ERROR",
    "EXTERNAL_SERVICE_ERROR",
  ],
};

// Circuit breaker state
export enum CircuitBreakerState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

// Circuit breaker configuration
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeoutMs: number;
  monitoringPeriodMs: number;
  halfOpenMaxCalls: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 60000, // 1 minute
  monitoringPeriodMs: 300000, // 5 minutes
  halfOpenMaxCalls: 3,
};

// Circuit breaker implementation
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenCalls: number = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(
    name: string,
    config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
  ) {
    this.name = name;
    this.config = config;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const correlationId = CorrelationContext.getCorrelationId();

    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.config.recoveryTimeoutMs) {
        const error = ErrorUtils.createError(
          "CIRCUIT_BREAKER_OPEN",
          `Circuit breaker ${this.name} is OPEN`,
          { circuitBreakerName: this.name, state: this.state },
          correlationId
        );

        this.logCircuitBreakerEvent("REJECTED", { correlationId });
        throw error;
      } else {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenCalls = 0;
        this.logCircuitBreakerEvent("HALF_OPEN", { correlationId });
      }
    }

    if (
      this.state === CircuitBreakerState.HALF_OPEN &&
      this.halfOpenCalls >= this.config.halfOpenMaxCalls
    ) {
      const error = ErrorUtils.createError(
        "CIRCUIT_BREAKER_HALF_OPEN_LIMIT",
        `Circuit breaker ${this.name} half-open call limit exceeded`,
        { circuitBreakerName: this.name, state: this.state },
        correlationId
      );

      this.logCircuitBreakerEvent("HALF_OPEN_LIMIT_EXCEEDED", {
        correlationId,
      });
      throw error;
    }

    try {
      if (this.state === CircuitBreakerState.HALF_OPEN) {
        this.halfOpenCalls++;
      }

      const result = await operation();

      // Success - reset failure count and close circuit if half-open
      if (this.state === CircuitBreakerState.HALF_OPEN) {
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.logCircuitBreakerEvent("CLOSED", { correlationId });
      } else if (this.state === CircuitBreakerState.CLOSED) {
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      this.recordFailure();
      this.logCircuitBreakerEvent("FAILURE", {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.logCircuitBreakerEvent("OPENED", {});
    }
  }

  private logCircuitBreakerEvent(
    event: string,
    context: Record<string, any>
  ): void {
    console.log(`Circuit Breaker [${this.name}] ${event}`, {
      circuitBreakerName: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      halfOpenCalls: this.halfOpenCalls,
      ...context,
    });
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenCalls = 0;
    this.logCircuitBreakerEvent("RESET", {});
  }
}

// Retry utility with exponential backoff
export class RetryHandler {
  private readonly config: RetryConfig;

  constructor(config: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.config = config;
  }

  async execute<T>(
    operation: () => Promise<T>,
    operationName: string = "operation"
  ): Promise<T> {
    const correlationId = CorrelationContext.getCorrelationId();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        console.log(
          `Executing ${operationName} - attempt ${attempt}/${this.config.maxAttempts}`,
          {
            correlationId,
            attempt,
            maxAttempts: this.config.maxAttempts,
          }
        );

        const result = await operation();

        if (attempt > 1) {
          console.log(`${operationName} succeeded after ${attempt} attempts`, {
            correlationId,
            attempt,
            totalAttempts: attempt,
          });
        }

        return result;
      } catch (error) {
        // Handle both Error instances and error objects
        if (error instanceof Error) {
          lastError = error;
        } else if (
          typeof error === "object" &&
          error !== null &&
          "message" in error
        ) {
          // Handle error objects like MangaPlatformError
          const errorObj = error as any;
          const errorInstance = new Error(errorObj.message || String(error));
          if (errorObj.code) {
            (errorInstance as any).code = errorObj.code;
          }
          lastError = errorInstance;
        } else {
          lastError = new Error(String(error));
        }

        console.warn(`${operationName} failed on attempt ${attempt}`, {
          correlationId,
          attempt,
          maxAttempts: this.config.maxAttempts,
          error: lastError.message,
          stack: lastError.stack,
        });

        // Check if error is retryable
        if (
          !this.isRetryableError(lastError) ||
          attempt === this.config.maxAttempts
        ) {
          console.error(`${operationName} failed permanently`, {
            correlationId,
            totalAttempts: attempt,
            finalError: lastError.message,
            retryable: this.isRetryableError(lastError),
          });
          throw lastError;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt);

        console.log(`Retrying ${operationName} in ${delay}ms`, {
          correlationId,
          attempt,
          delayMs: delay,
          nextAttempt: attempt + 1,
        });

        await this.sleep(delay);
      }
    }

    throw (
      lastError ||
      new Error(
        `${operationName} failed after ${this.config.maxAttempts} attempts`
      )
    );
  }

  private isRetryableError(error: Error): boolean {
    // Check if error has a code property (MangaPlatformError)
    const errorWithCode = error as any;
    if (
      errorWithCode.code &&
      this.config.retryableErrors.includes(errorWithCode.code)
    ) {
      return true;
    }

    // Check common error patterns
    const message = error.message.toLowerCase();
    const retryablePatterns = [
      "timeout",
      "throttl",
      "rate limit",
      "service unavailable",
      "internal server error",
      "connection",
      "network",
      "econnreset",
      "enotfound",
      "etimedout",
    ];

    return retryablePatterns.some((pattern) => message.includes(pattern));
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay =
      this.config.baseDelayMs *
      Math.pow(this.config.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);
    const jitter = Math.random() * this.config.jitterMs;

    return Math.floor(cappedDelay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Enhanced error logger with correlation IDs
export class ErrorLogger {
  static logError(
    error: Error | MangaPlatformError,
    context: Record<string, any> = {},
    operationName?: string
  ): void {
    const correlationId = CorrelationContext.getCorrelationId();
    const timestamp = new Date().toISOString();

    const logData = {
      timestamp,
      correlationId,
      operationName,
      error: {
        name: error.name,
        message: error.message,
        code: (error as any).code,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      context,
    };

    console.error("Error occurred:", JSON.stringify(logData, null, 2));
  }

  static logWarning(
    message: string,
    context: Record<string, any> = {},
    operationName?: string
  ): void {
    const correlationId = CorrelationContext.getCorrelationId();
    const timestamp = new Date().toISOString();

    const logData = {
      timestamp,
      correlationId,
      operationName,
      level: "WARNING",
      message,
      context,
    };

    console.warn("Warning:", JSON.stringify(logData, null, 2));
  }

  static logInfo(
    message: string,
    context: Record<string, any> = {},
    operationName?: string
  ): void {
    const correlationId = CorrelationContext.getCorrelationId();
    const timestamp = new Date().toISOString();

    const logData = {
      timestamp,
      correlationId,
      operationName,
      level: "INFO",
      message,
      context,
    };

    console.log("Info:", JSON.stringify(logData, null, 2));
  }
}

// Lambda function wrapper with error handling
export function withErrorHandling<TEvent, TResult>(
  handler: (event: TEvent, correlationId: string) => Promise<TResult>,
  operationName: string
) {
  return async (event: TEvent): Promise<TResult> => {
    // Generate or extract correlation ID
    const correlationId =
      (event as any).requestContext?.requestId ||
      (event as any).detail?.correlationId ||
      uuidv4();

    CorrelationContext.setCorrelationId(correlationId);

    try {
      ErrorLogger.logInfo(
        `Starting ${operationName}`,
        { event },
        operationName
      );

      const result = await handler(event, correlationId);

      ErrorLogger.logInfo(
        `Completed ${operationName}`,
        { result },
        operationName
      );

      return result;
    } catch (error) {
      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { event },
        operationName
      );
      throw error;
    } finally {
      CorrelationContext.clear();
    }
  };
}

// Circuit breaker registry for managing multiple circuit breakers
export class CircuitBreakerRegistry {
  private static breakers: Map<string, CircuitBreaker> = new Map();

  static getOrCreate(
    name: string,
    config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
  ): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, config));
    }
    return this.breakers.get(name)!;
  }

  static get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  static reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }

  static resetAll(): void {
    this.breakers.forEach((breaker) => breaker.reset());
  }

  static getStatus(): Record<
    string,
    { state: CircuitBreakerState; failureCount: number }
  > {
    const status: Record<
      string,
      { state: CircuitBreakerState; failureCount: number }
    > = {};

    this.breakers.forEach((breaker, name) => {
      status[name] = {
        state: breaker.getState(),
        failureCount: breaker.getFailureCount(),
      };
    });

    return status;
  }
}
