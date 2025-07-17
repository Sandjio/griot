import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  UserPreferencesData,
  QlooInsights,
  BedrockResponse,
} from "../../types/data-models";
import {
  CircuitBreakerRegistry,
  RetryHandler,
  EXTERNAL_API_RETRY_CONFIG,
  ErrorLogger,
  CorrelationContext,
} from "../../utils/error-handler";
import { ErrorUtils } from "../../types/error-types";

/**
 * Amazon Bedrock Client for Story Generation
 *
 * Integrates with Amazon Bedrock to generate manga story content
 * using Claude 3 Sonnet model based on user preferences and insights.
 */
export class BedrockClient {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private circuitBreaker;
  private retryHandler;

  constructor() {
    this.client = new BedrockRuntimeClient({
      region:
        process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1",
    });
    this.modelId = "anthropic.claude-3-sonnet-20240229-v1:0";

    // Initialize circuit breaker for Bedrock story generation
    this.circuitBreaker = CircuitBreakerRegistry.getOrCreate(
      "bedrock-story-generation",
      {
        failureThreshold: 5,
        recoveryTimeoutMs: 60000, // 1 minute
        monitoringPeriodMs: 300000, // 5 minutes
        halfOpenMaxCalls: 3,
      }
    );

    // Initialize retry handler with external API configuration
    this.retryHandler = new RetryHandler(EXTERNAL_API_RETRY_CONFIG);
  }

  /**
   * Generate story content based on user preferences and insights
   */
  async generateStory(
    preferences: UserPreferencesData,
    insights: QlooInsights
  ): Promise<BedrockResponse> {
    const correlationId = CorrelationContext.getCorrelationId();
    const prompt = this.buildStoryPrompt(preferences, insights);

    ErrorLogger.logInfo(
      "Generating story with Bedrock",
      {
        modelId: this.modelId,
        promptLength: prompt.length,
        preferences: {
          genres: preferences.genres,
          themes: preferences.themes,
          artStyle: preferences.artStyle,
          targetAudience: preferences.targetAudience,
          contentRating: preferences.contentRating,
        },
        correlationId,
      },
      "BedrockClient.generateStory"
    );

    try {
      // Use circuit breaker with retry handler
      return await this.circuitBreaker.execute(async () => {
        return await this.retryHandler.execute(async () => {
          return await this.makeBedrockCall(prompt);
        }, "BedrockStoryGeneration");
      });
    } catch (error) {
      // Convert to standardized error format
      const standardError = this.handleBedrockError(error, correlationId);
      ErrorLogger.logError(
        standardError,
        { preferences, insights },
        "BedrockClient.generateStory"
      );
      throw standardError;
    }
  }

  /**
   * Make the actual Bedrock API call
   */
  private async makeBedrockCall(prompt: string): Promise<BedrockResponse> {
    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4000,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      body: JSON.stringify(requestBody),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await this.client.send(command);

    if (!response.body) {
      throw new Error("No response body received from Bedrock");
    }

    // Parse the response
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (
      !responseBody.content ||
      !responseBody.content[0] ||
      !responseBody.content[0].text
    ) {
      throw new Error("Invalid response format from Bedrock");
    }

    const content = responseBody.content[0].text;
    const usage = responseBody.usage
      ? {
          inputTokens: responseBody.usage.input_tokens || 0,
          outputTokens: responseBody.usage.output_tokens || 0,
        }
      : undefined;

    ErrorLogger.logInfo(
      "Successfully generated story content",
      {
        contentLength: content.length,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      },
      "BedrockClient.makeBedrockCall"
    );

    return {
      content,
      usage,
    };
  }

  /**
   * Handle Bedrock-specific errors and convert to standardized format
   */
  private handleBedrockError(error: any, correlationId: string): Error {
    if (error instanceof Error) {
      if (
        error.message.includes("throttling") ||
        error.message.includes("ThrottlingException")
      ) {
        return ErrorUtils.createError(
          "THROTTLING_ERROR",
          "Bedrock service is currently throttled. Please try again later.",
          {
            service: "bedrock",
            operation: "generateStory",
            retryable: true,
          },
          correlationId
        );
      }
      if (
        error.message.includes("content filter") ||
        error.message.includes("ContentPolicyViolation")
      ) {
        return ErrorUtils.createError(
          "EXTERNAL_SERVICE_ERROR",
          "Generated content was filtered. Please adjust your preferences and try again.",
          {
            service: "bedrock",
            operation: "generateStory",
            retryable: false,
          },
          correlationId
        );
      }
      if (
        error.message.includes("model not found") ||
        error.message.includes("ModelNotFound")
      ) {
        return ErrorUtils.createError(
          "EXTERNAL_SERVICE_ERROR",
          "The specified Bedrock model is not available in this region.",
          {
            service: "bedrock",
            operation: "generateStory",
            retryable: false,
          },
          correlationId
        );
      }
      if (
        error.message.includes("timeout") ||
        error.message.includes("TimeoutError")
      ) {
        return ErrorUtils.createError(
          "TIMEOUT_ERROR",
          "Bedrock request timed out.",
          {
            service: "bedrock",
            operation: "generateStory",
            retryable: true,
          },
          correlationId
        );
      }
    }

    // Default to external service error
    return ErrorUtils.createError(
      "EXTERNAL_SERVICE_ERROR",
      `Failed to generate story content: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        service: "bedrock",
        operation: "generateStory",
        retryable: true,
      },
      correlationId
    );
  }

  /**
   * Build the story generation prompt based on preferences and insights
   */
  private buildStoryPrompt(
    preferences: UserPreferencesData,
    insights: QlooInsights
  ): string {
    // Extract key insights for prompt enhancement
    const topRecommendations = insights.recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => r.category);

    const topTrends = insights.trends
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 3)
      .map((t) => t.topic);

    return `You are a creative manga story writer. Create an engaging manga story based on the following user preferences and market insights.

USER PREFERENCES:
- Genres: ${preferences.genres.join(", ")}
- Themes: ${preferences.themes.join(", ")}
- Art Style: ${preferences.artStyle}
- Target Audience: ${preferences.targetAudience}
- Content Rating: ${preferences.contentRating}

MARKET INSIGHTS:
- Popular Categories: ${topRecommendations.join(", ")}
- Trending Topics: ${topTrends.join(", ")}

STORY REQUIREMENTS:
1. Create a compelling story that incorporates the user's preferred genres and themes
2. Ensure the content is appropriate for the target audience (${
      preferences.targetAudience
    }) and content rating (${preferences.contentRating})
3. The story should be suitable for ${preferences.artStyle} art style
4. Include elements from the trending topics where relevant
5. Structure the story with a clear beginning, middle, and end
6. Make it engaging and suitable for manga format (visual storytelling)
7. Length should be approximately 2000-3000 words
8. Include dialogue and action sequences appropriate for manga

FORMATTING:
- Start with a clear title for the story
- Use proper paragraph breaks for readability
- Include dialogue in quotation marks
- Add scene descriptions that would work well with manga panels
- Use [Scene Break] to indicate major scene transitions

Please generate a complete manga story now:`;
  }

  /**
   * Validate that the generated content meets basic requirements
   */
  private validateGeneratedContent(
    content: string,
    preferences: UserPreferencesData
  ): boolean {
    // Basic validation checks
    if (content.length < 500) {
      console.warn("Generated content is too short", {
        length: content.length,
      });
      return false;
    }

    if (content.length > 10000) {
      console.warn("Generated content is too long", { length: content.length });
      return false;
    }

    // Check for content rating compliance (basic checks)
    if (
      preferences.contentRating === "G" ||
      preferences.contentRating === "PG"
    ) {
      const inappropriateWords = [
        "violence",
        "blood",
        "death",
        "kill",
        "murder",
      ];
      const lowerContent = content.toLowerCase();

      for (const word of inappropriateWords) {
        if (lowerContent.includes(word)) {
          console.warn("Content may not be appropriate for rating", {
            rating: preferences.contentRating,
            foundWord: word,
          });
          // Don't fail validation, just warn - let content filters handle this
        }
      }
    }

    return true;
  }
}
