import { UserPreferencesData, QlooInsights } from "../../types/data-models";

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

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export class QlooApiClient {
  private apiUrl: string;
  private apiKey: string;
  private retryConfig: RetryConfig;
  private timeout: number;

  constructor() {
    this.apiUrl = process.env.QLOO_API_URL || "";
    this.apiKey = process.env.QLOO_API_KEY || "";
    this.timeout = parseInt(process.env.QLOO_API_TIMEOUT || "10000", 10);

    this.retryConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
    };

    if (!this.apiUrl || !this.apiKey) {
      throw new Error(
        "Qloo API configuration is missing. Please set QLOO_API_URL and QLOO_API_KEY environment variables."
      );
    }
  }

  /**
   * Fetch insights from Qloo API based on user preferences
   */
  async fetchInsights(preferences: UserPreferencesData): Promise<QlooInsights> {
    const requestPayload = this.buildQlooRequest(preferences);

    console.log("Fetching insights from Qloo API", {
      url: this.apiUrl,
      payload: requestPayload,
    });

    return this.executeWithRetry(async () => {
      const response = await this.makeApiCall(requestPayload);
      return this.parseQlooResponse(response);
    });
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
   * Execute API call with exponential backoff retry logic
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error = new Error("Unknown error");

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on certain error types
        if (error instanceof QlooApiError && !this.shouldRetry(error)) {
          throw error;
        }

        // Don't retry on the last attempt
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
          this.retryConfig.baseDelayMs *
            Math.pow(this.retryConfig.backoffMultiplier, attempt),
          this.retryConfig.maxDelayMs
        );

        // Add jitter to prevent thundering herd
        const jitteredDelay = delay + Math.random() * 1000;

        console.log(`Qloo API call failed, retrying in ${jitteredDelay}ms`, {
          attempt: attempt + 1,
          maxRetries: this.retryConfig.maxRetries,
          error: lastError.message,
        });

        await this.sleep(jitteredDelay);
      }
    }

    throw lastError;
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

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
