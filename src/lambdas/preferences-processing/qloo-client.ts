import { UserPreferencesData, QlooInsights } from "../../types/data-models";
import {
  CircuitBreakerRegistry,
  RetryHandler,
  EXTERNAL_API_RETRY_CONFIG,
  ErrorLogger,
  CorrelationContext,
} from "../../utils/error-handler";
import { ErrorUtils } from "../../types/error-types";

/**
 * Qloo API Client
 *
 * Handles integration with Qloo API for user preference insights
 * Implements retry logic, error handling, and rate limiting compliance
 *
 * Requirements: 2.2, 2.3, 2.6
 */

interface QlooApiResponse {
  recommendations: Array<{
    category: string;
    score: number;
    attributes: Record<string, any>;
  }>;
  trends: Array<{
    topic: string;
    popularity: number;
  }>;
  status: "success" | "error";
  message?: string;
}

export class QlooApiClient {
  private apiUrl: string;
  private apiKey: string;
  private timeout: number;
  private circuitBreaker;
  private retryHandler;

  constructor() {
    this.apiUrl = process.env.QLOO_API_URL || "";
    this.apiKey = process.env.QLOO_API_KEY || "";
    this.timeout = parseInt(process.env.QLOO_API_TIMEOUT || "10000", 10);

    if (!this.apiUrl || !this.apiKey) {
      throw new Error(
        "Qloo API configuration is missing. Please set QLOO_API_URL and QLOO_API_KEY environment variables."
      );
    }

    // Initialize circuit breaker for Qloo API
    this.circuitBreaker = CircuitBreakerRegistry.getOrCreate("qloo-api", {
      failureThreshold: 3,
      recoveryTimeoutMs: 30000, // 30 seconds
      monitoringPeriodMs: 300000, // 5 minutes
      halfOpenMaxCalls: 2,
    });

    // Initialize retry handler with external API configuration
    this.retryHandler = new RetryHandler(EXTERNAL_API_RETRY_CONFIG);
  }

  /**
   * Fetch insights from Qloo API based on user preferences
   */
  async fetchInsights(preferences: UserPreferencesData): Promise<QlooInsights> {
    const correlationId = CorrelationContext.getCorrelationId();
    const requestPayload = this.buildQlooRequest(preferences);

    ErrorLogger.logInfo(
      "Fetching insights from Qloo API",
      {
        url: this.apiUrl,
        payload: requestPayload,
        correlationId,
      },
      "QlooApiClient.fetchInsights"
    );

    try {
      // Use circuit breaker with retry handler
      return await this.circuitBreaker.execute(async () => {
        return await this.retryHandler.execute(async () => {
          const response = await this.makeApiCall(requestPayload);
          return this.parseQlooResponse(response);
        }, "QlooApiCall");
      });
    } catch (error) {
      // Convert QlooApiError to standardized error format
      if (error instanceof QlooApiError) {
        const standardError = ErrorUtils.createError(
          "EXTERNAL_SERVICE_ERROR",
          error.message,
          {
            service: "qloo-api",
            operation: "fetchInsights",
            statusCode: error.statusCode,
            responseBody: error.responseBody,
            retryable: this.shouldRetry(error),
          },
          correlationId
        );

        ErrorLogger.logError(
          standardError instanceof Error
            ? standardError
            : new Error(String(standardError)),
          { preferences },
          "QlooApiClient.fetchInsights"
        );
        throw standardError;
      }

      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { preferences },
        "QlooApiClient.fetchInsights"
      );
      throw error;
    }
  }

  /**
   * Build Qloo API request payload from user preferences
   */
  private buildQlooRequest(
    preferences: UserPreferencesData
  ): Record<string, any> {
    return {
      user_preferences: {
        genres: preferences.genres,
        themes: preferences.themes,
        art_style: preferences.artStyle,
        target_audience: preferences.targetAudience,
        content_rating: preferences.contentRating,
      },
      request_type: "manga_insights",
      include_recommendations: true,
      include_trends: true,
      max_recommendations: 10,
      max_trends: 5,
    };
  }

  /**
   * Make HTTP request to Qloo API
   */
  private async makeApiCall(
    payload: Record<string, any>
  ): Promise<QlooApiResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": "MangaPlatform/1.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new QlooApiError(
          `Qloo API request failed with status ${response.status}`,
          response.status,
          errorText
        );
      }

      const data = await response.json();
      return data as QlooApiResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof QlooApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new QlooApiError(
          "Qloo API request timed out",
          408,
          "Request timeout"
        );
      }

      throw new QlooApiError(
        `Qloo API request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        500,
        "Network error"
      );
    }
  }

  /**
   * Parse Qloo API response and convert to internal format
   */
  private parseQlooResponse(response: QlooApiResponse): QlooInsights {
    if (response.status === "error") {
      throw new QlooApiError(
        `Qloo API returned error: ${response.message || "Unknown error"}`,
        400,
        response.message || "API error"
      );
    }

    // Validate response structure
    if (!response.recommendations || !Array.isArray(response.recommendations)) {
      throw new QlooApiError(
        "Invalid Qloo API response: missing recommendations",
        500,
        "Invalid response format"
      );
    }

    if (!response.trends || !Array.isArray(response.trends)) {
      throw new QlooApiError(
        "Invalid Qloo API response: missing trends",
        500,
        "Invalid response format"
      );
    }

    return {
      recommendations: response.recommendations.map((rec) => ({
        category: rec.category || "unknown",
        score: typeof rec.score === "number" ? rec.score : 0,
        attributes: rec.attributes || {},
      })),
      trends: response.trends.map((trend) => ({
        topic: trend.topic || "unknown",
        popularity: typeof trend.popularity === "number" ? trend.popularity : 0,
      })),
    };
  }

  /**
   * Determine if an error should trigger a retry
   */
  private shouldRetry(error: QlooApiError): boolean {
    // Retry on server errors (5xx) and rate limiting (429)
    return (
      error.statusCode >= 500 ||
      error.statusCode === 429 ||
      error.statusCode === 408
    );
  }
}

/**
 * Custom error class for Qloo API errors
 */
export class QlooApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = "QlooApiError";
  }
}

/**
 * Mock Qloo client for testing and development
 */
export class MockQlooApiClient {
  async fetchInsights(preferences: UserPreferencesData): Promise<QlooInsights> {
    console.log("Using mock Qloo API client", { preferences });

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Generate mock insights based on preferences
    return {
      recommendations: [
        {
          category: "Action",
          score: 0.9,
          attributes: {
            intensity: "high",
            violence_level: "moderate",
            themes: preferences.themes,
          },
        },
        {
          category: "Adventure",
          score: 0.8,
          attributes: {
            setting: "fantasy",
            character_development: "strong",
            art_style: preferences.artStyle,
          },
        },
        {
          category: "Drama",
          score: 0.7,
          attributes: {
            emotional_depth: "high",
            target_audience: preferences.targetAudience,
            content_rating: preferences.contentRating,
          },
        },
      ],
      trends: [
        {
          topic: "Isekai Adventures",
          popularity: 0.95,
        },
        {
          topic: "School Life",
          popularity: 0.85,
        },
        {
          topic: "Supernatural Powers",
          popularity: 0.8,
        },
      ],
    };
  }
}
