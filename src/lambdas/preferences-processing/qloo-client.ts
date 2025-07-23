import { UserPreferencesData, QlooInsights } from "../../types/data-models";
import {
  CircuitBreakerRegistry,
  RetryHandler,
  EXTERNAL_API_RETRY_CONFIG,
  ErrorLogger,
  CorrelationContext,
} from "../../utils/error-handler";
import { ErrorUtils } from "../../types/error-types";
import { resolveGenreTags } from "../../utils/tag.mapper";
/**
 * Qloo API Client
 *
 * Handles integration with Qloo API for user preference insights
 * Implements retry logic, error handling, and rate limiting compliance
 *
 * Requirements: 2.2, 2.3, 2.6
 */

interface QlooApiResponse {
  // Qloo API returns an array of entities or a different structure
  // We'll make this flexible to handle the actual response
  [key: string]: any;
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

    ErrorLogger.logInfo(
      "Fetching insights from Qloo API",
      {
        url: this.apiUrl,
        preferences,
        correlationId,
      },
      "QlooApiClient.fetchInsights"
    );

    try {
      // Use circuit breaker with retry handler
      return await this.circuitBreaker.execute(async () => {
        return await this.retryHandler.execute(async () => {
          const response = await this.makeApiCall(preferences);
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
   * Make HTTP request to Qloo API
   */
  private async makeApiCall(
    preferences: UserPreferencesData
  ): Promise<QlooApiResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resolvedGenres = resolveGenreTags(preferences.genres || []);
      const resolvedThemes = resolveGenreTags(preferences.themes || []);

      // Combine genres and themes as tags
      const allTags = [...resolvedGenres, ...resolvedThemes].filter(Boolean);

      // Try different entity types in order of preference
      // Based on Qloo API supported entities: Artist, Book, Brand, Destination, Movie, Person, Place, Podcast, TV Show, Video Game
      const entityTypes = [
        "urn:entity:book", // Most relevant for manga/comics
        "urn:entity:tv_show", // For anime/animated series
        "urn:entity:movie", // For live-action adaptations
        "urn:entity:video_game", // For game adaptations
      ];

      let lastError: QlooApiError | null = null;

      // Try each entity type until one works
      for (const entityType of entityTypes) {
        try {
          // Build query parameters for Qloo API
          const queryParams = new URLSearchParams();
          queryParams.append("filter.type", entityType);

          if (allTags.length > 0) {
            queryParams.append("filter.tags", allTags.join(","));
          }

          // Add content rating if available
          if (preferences.contentRating) {
            queryParams.append(
              "filter.content_rating",
              preferences.contentRating
            );
          }

          queryParams.append("take", "10");

          const url = `${this.apiUrl}?${queryParams.toString()}`;

          ErrorLogger.logInfo(
            "Making Qloo API request",
            {
              url,
              entityType,
              resolvedGenres,
              resolvedThemes,
              allTags,
              originalPreferences: preferences,
            },
            "QlooApiClient.makeApiCall"
          );

          const response = await fetch(url, {
            method: "GET",
            headers: {
              "x-api-key": this.apiKey,
              "User-Agent": "MangaPlatform/1.0",
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text();
            const error = new QlooApiError(
              `Qloo API request failed with status ${response.status} for entity type ${entityType}`,
              response.status,
              errorText
            );

            // If it's a 403 (forbidden), try the next entity type
            if (response.status === 403) {
              ErrorLogger.logInfo(
                `Entity type ${entityType} not permitted, trying next type`,
                {
                  status: response.status,
                  entityType,
                  responseBody: errorText,
                },
                "QlooApiClient.makeApiCall"
              );
              lastError = error;
              continue;
            }

            // For other errors, throw immediately
            ErrorLogger.logError(
              new Error(`Qloo API error response: ${errorText}`),
              {
                status: response.status,
                url,
                entityType,
                responseBody: errorText,
              },
              "QlooApiClient.makeApiCall"
            );
            throw error;
          }

          // Success! Parse and return the response
          const data = await response.json();
          ErrorLogger.logInfo(
            "Qloo API response received",
            {
              responseKeys: Object.keys(data),
              dataType: typeof data,
              entityType,
              success: true,
            },
            "QlooApiClient.makeApiCall"
          );

          clearTimeout(timeoutId);

          return data as QlooApiResponse;
        } catch (error) {
          if (error instanceof QlooApiError && error.statusCode === 403) {
            lastError = error;
            continue; // Try next entity type
          }
          throw error; // Re-throw non-403 errors
        }
      }

      // If we get here, all entity types failed
      clearTimeout(timeoutId);
      if (lastError) {
        ErrorLogger.logError(
          new Error(
            `All entity types failed. Last error: ${lastError.message}`
          ),
          {
            triedEntityTypes: entityTypes,
            lastErrorStatus: lastError.statusCode,
            lastErrorBody: lastError.responseBody,
          },
          "QlooApiClient.makeApiCall"
        );
        throw lastError;
      }

      throw new QlooApiError(
        "All entity types failed with unknown errors",
        500,
        "No valid entity type found"
      );
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
    ErrorLogger.logInfo(
      "Parsing Qloo API response",
      {
        responseType: typeof response,
        success: response.success,
        hasResults: !!response.results,
        hasEntities: !!(response.results && response.results.entities),
        entitiesCount: response.results?.entities?.length || 0,
      },
      "QlooApiClient.parseQlooResponse"
    );

    // Check if the response indicates success
    if (response.success === false) {
      throw new QlooApiError(
        `Qloo API returned error: ${response.message || "Unknown error"}`,
        400,
        JSON.stringify(response)
      );
    }

    // Extract entities from the Qloo API response structure
    let entities: any[] = [];

    if (response.results && Array.isArray(response.results.entities)) {
      entities = response.results.entities;
    } else if (Array.isArray(response.results)) {
      // Fallback: results is directly an array
      entities = response.results;
    } else if (Array.isArray(response.entities)) {
      // Fallback: entities at root level
      entities = response.entities;
    } else {
      ErrorLogger.logInfo(
        "No entities found in Qloo response",
        {
          responseStructure: {
            success: response.success,
            hasResults: !!response.results,
            resultsType: typeof response.results,
            resultsKeys: response.results ? Object.keys(response.results) : [],
          },
        },
        "QlooApiClient.parseQlooResponse"
      );
      entities = [];
    }

    ErrorLogger.logInfo(
      "Extracted entities from Qloo response",
      {
        entitiesCount: entities.length,
        firstEntityKeys: entities.length > 0 ? Object.keys(entities[0]) : [],
        firstEntityName: entities.length > 0 ? entities[0].name : null,
      },
      "QlooApiClient.parseQlooResponse"
    );

    // Convert Qloo entities to our internal format
    const recommendations = entities.slice(0, 10).map((entity, index) => ({
      category: this.extractCategory(entity),
      score: this.extractScore(entity, index),
      attributes: this.extractAttributes(entity),
    }));

    // Generate trends from the entities
    const trends = this.generateTrendsFromEntities(entities);

    return {
      recommendations,
      trends,
    };
  }

  /**
   * Extract category from Qloo entity
   */
  private extractCategory(entity: any): string {
    // Try direct properties first
    if (entity.genre) return entity.genre;
    if (entity.category) return entity.category;

    // Extract from subtype (e.g., "urn:entity:movie" -> "movie")
    if (entity.subtype && typeof entity.subtype === "string") {
      const parts = entity.subtype.split(":");
      const subtype = parts[parts.length - 1];
      if (subtype && subtype !== "entity") {
        return subtype;
      }
    }

    // Extract genre from tags array (Qloo format: objects with id, name, type)
    if (entity.tags && Array.isArray(entity.tags) && entity.tags.length > 0) {
      // Look for genre tags
      const genreTag = entity.tags.find(
        (tag: any) =>
          tag && typeof tag === "object" && tag.type === "urn:tag:genre:media"
      );

      if (genreTag && genreTag.name) {
        return genreTag.name.toLowerCase();
      }

      // Fallback: look for genre in tag IDs
      const genreTagById = entity.tags.find(
        (tag: any) =>
          tag &&
          typeof tag === "object" &&
          tag.id &&
          typeof tag.id === "string" &&
          tag.id.includes("genre:media:")
      );

      if (genreTagById) {
        const parts = genreTagById.id.split(":");
        return parts[parts.length - 1] || "unknown";
      }
    }

    // Fallback to entity type
    if (entity.type) return entity.type;

    return "book"; // Default fallback (most relevant for manga platform)
  }

  /**
   * Extract score from Qloo entity
   */
  private extractScore(entity: any, fallbackIndex: number): number {
    if (typeof entity.score === "number") return entity.score;
    if (typeof entity.rating === "number") return entity.rating / 10; // Normalize to 0-1
    if (typeof entity.popularity === "number") return entity.popularity;
    if (typeof entity.relevance === "number") return entity.relevance;
    // Generate decreasing score based on position
    return Math.max(0.1, 1 - fallbackIndex * 0.1);
  }

  /**
   * Extract attributes from Qloo entity
   */
  private extractAttributes(entity: any): Record<string, any> {
    const attributes: Record<string, any> = {};

    // Basic entity properties
    if (entity.name) attributes.name = entity.name;
    if (entity.entity_id) attributes.entityId = entity.entity_id;
    if (entity.popularity) attributes.popularity = entity.popularity;

    // Properties from the nested properties object
    if (entity.properties) {
      const props = entity.properties;

      if (props.description) attributes.description = props.description;
      if (props.release_year) attributes.releaseYear = props.release_year;
      if (props.release_date) attributes.releaseDate = props.release_date;
      if (props.content_rating) attributes.contentRating = props.content_rating;
      if (props.duration) attributes.duration = props.duration;
      if (props.image && props.image.url) attributes.imageUrl = props.image.url;
      if (props.production_companies)
        attributes.productionCompanies = props.production_companies;
      if (props.release_country)
        attributes.releaseCountry = props.release_country;
    }

    // Tags information (simplified for our use case)
    if (entity.tags && Array.isArray(entity.tags)) {
      attributes.tagCount = entity.tags.length;
      // Extract genre tags specifically
      const genreTags = entity.tags
        .filter((tag: any) => tag.type === "urn:tag:genre:media")
        .map((tag: any) => tag.name);
      if (genreTags.length > 0) {
        attributes.genres = genreTags;
      }
    }

    // External ratings if available
    if (entity.external) {
      if (entity.external.imdb && entity.external.imdb[0]) {
        attributes.imdbRating = entity.external.imdb[0].user_rating;
      }
      if (entity.external.metacritic && entity.external.metacritic[0]) {
        attributes.metacriticRating =
          entity.external.metacritic[0].critic_rating;
      }
    }

    return attributes;
  }

  /**
   * Generate trends from entities (since Qloo might not provide trends directly)
   */
  private generateTrendsFromEntities(
    entities: any[]
  ): Array<{ topic: string; popularity: number }> {
    const genreCounts: Record<string, number> = {};

    // Count genres from entities
    entities.forEach((entity) => {
      const category = this.extractCategory(entity);
      genreCounts[category] = (genreCounts[category] || 0) + 1;
    });

    // Convert to trends format
    return Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a) // Sort by count descending
      .slice(0, 5) // Top 5 trends
      .map(([topic, count]) => ({
        topic: topic.charAt(0).toUpperCase() + topic.slice(1), // Capitalize
        popularity: Math.min(1, count / entities.length), // Normalize to 0-1
      }));
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
