import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  UserPreferencesData,
  QlooInsights,
  BedrockResponse,
} from "../../types/data-models";

/**
 * Amazon Bedrock Client for Story Generation
 *
 * Integrates with Amazon Bedrock to generate manga story content
 * using Claude 3 Sonnet model based on user preferences and insights.
 */
export class BedrockClient {
  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor() {
    this.client = new BedrockRuntimeClient({
      region:
        process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1",
    });
    this.modelId = "anthropic.claude-3-sonnet-20240229-v1:0";
  }

  /**
   * Generate story content based on user preferences and insights
   */
  async generateStory(
    preferences: UserPreferencesData,
    insights: QlooInsights
  ): Promise<BedrockResponse> {
    const prompt = this.buildStoryPrompt(preferences, insights);

    console.log("Generating story with Bedrock", {
      modelId: this.modelId,
      promptLength: prompt.length,
      preferences: {
        genres: preferences.genres,
        themes: preferences.themes,
        artStyle: preferences.artStyle,
        targetAudience: preferences.targetAudience,
        contentRating: preferences.contentRating,
      },
    });

    try {
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

      console.log("Successfully generated story content", {
        contentLength: content.length,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      });

      return {
        content,
        usage,
      };
    } catch (error) {
      console.error("Error generating story with Bedrock", {
        error: error instanceof Error ? error.message : String(error),
        modelId: this.modelId,
      });

      // Handle specific Bedrock errors
      if (error instanceof Error) {
        if (error.message.includes("throttling")) {
          throw new Error(
            "Bedrock service is currently throttled. Please try again later."
          );
        }
        if (error.message.includes("content filter")) {
          throw new Error(
            "Generated content was filtered. Please adjust your preferences and try again."
          );
        }
        if (error.message.includes("model not found")) {
          throw new Error(
            "The specified Bedrock model is not available in this region."
          );
        }
      }

      throw new Error(
        `Failed to generate story content: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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

  /**
   * Retry story generation with modified parameters if needed
   */
  async generateStoryWithRetry(
    preferences: UserPreferencesData,
    insights: QlooInsights,
    maxRetries: number = 2
  ): Promise<BedrockResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await this.generateStory(preferences, insights);

        // Validate the generated content
        if (this.validateGeneratedContent(result.content, preferences)) {
          return result;
        } else {
          throw new Error("Generated content failed validation checks");
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        console.warn(`Story generation attempt ${attempt} failed`, {
          error: lastError.message,
          attempt,
          maxRetries: maxRetries + 1,
        });

        // Don't retry on certain errors
        if (
          lastError.message.includes("content filter") ||
          lastError.message.includes("model not found")
        ) {
          throw lastError;
        }

        // Wait before retry (exponential backoff)
        if (attempt <= maxRetries) {
          const waitTime = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
          console.log(`Waiting ${waitTime}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    throw lastError || new Error("Story generation failed after all retries");
  }
}
