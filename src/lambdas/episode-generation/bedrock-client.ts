import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { BedrockResponse } from "../../types/data-models";
import { UserPreferencesData } from "../../types/data-models";

/**
 * Amazon Bedrock Client for Episode Generation
 *
 * Integrates with Amazon Bedrock to generate manga episode content
 * using Claude 3 Sonnet model based on story content and episode number.
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
   * Generate episode content based on story content and episode number
   */
  async generateEpisode(
    storyContent: string,
    episodeNumber: number,
    storyTitle: string
  ): Promise<BedrockResponse> {
    const prompt = this.buildEpisodePrompt(
      storyContent,
      episodeNumber,
      storyTitle
    );

    console.log("Generating episode with Bedrock", {
      modelId: this.modelId,
      promptLength: prompt.length,
      episodeNumber,
      storyTitle,
      storyContentLength: storyContent.length,
    });

    try {
      const requestBody = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 3000,
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

      console.log("Successfully generated episode content", {
        episodeNumber,
        contentLength: content.length,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      });

      return {
        content,
        usage,
      };
    } catch (error) {
      console.error("Error generating episode with Bedrock", {
        error: error instanceof Error ? error.message : String(error),
        modelId: this.modelId,
        episodeNumber,
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
            "Generated content was filtered. Please adjust the story content and try again."
          );
        }
        if (error.message.includes("model not found")) {
          throw new Error(
            "The specified Bedrock model is not available in this region."
          );
        }
      }

      throw new Error(
        `Failed to generate episode content: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Generate episode content with user preferences context for continue episodes
   */
  async generateEpisodeWithPreferences(
    storyContent: string,
    episodeNumber: number,
    storyTitle: string,
    userPreferences?: UserPreferencesData
  ): Promise<BedrockResponse> {
    const prompt = this.buildEpisodePromptWithPreferences(
      storyContent,
      episodeNumber,
      storyTitle,
      userPreferences
    );

    console.log("Generating episode with preferences context", {
      modelId: this.modelId,
      promptLength: prompt.length,
      episodeNumber,
      storyTitle,
      storyContentLength: storyContent.length,
      hasPreferences: !!userPreferences,
    });

    try {
      const requestBody = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 3000,
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

      console.log("Successfully generated episode content with preferences", {
        episodeNumber,
        contentLength: content.length,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        hasPreferences: !!userPreferences,
      });

      return {
        content,
        usage,
      };
    } catch (error) {
      console.error("Error generating episode with preferences", {
        error: error instanceof Error ? error.message : String(error),
        modelId: this.modelId,
        episodeNumber,
        hasPreferences: !!userPreferences,
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
            "Generated content was filtered. Please adjust the story content and try again."
          );
        }
        if (error.message.includes("model not found")) {
          throw new Error(
            "The specified Bedrock model is not available in this region."
          );
        }
      }

      throw new Error(
        `Failed to generate episode content with preferences: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Build the episode generation prompt based on story content and episode number
   */
  private buildEpisodePrompt(
    storyContent: string,
    episodeNumber: number,
    storyTitle: string
  ): string {
    // Extract key elements from the story for context
    const storyLines = storyContent.split("\n");
    const storyPreview = storyLines.slice(0, 50).join("\n"); // First 50 lines for context

    return `You are a skilled manga episode writer. Based on the provided story content, create Episode ${episodeNumber} that continues the narrative in an engaging way suitable for manga format.

STORY CONTEXT:
Title: ${storyTitle}
Story Content Preview:
${storyPreview}

${
  storyContent.length > storyPreview.length
    ? `\n[Story continues with ${storyLines.length - 50} more lines...]\n`
    : ""
}

EPISODE REQUIREMENTS:
1. Create Episode ${episodeNumber} that naturally continues from the story
2. The episode should be self-contained but part of the larger narrative
3. Include engaging dialogue and action sequences suitable for manga panels
4. Maintain consistency with characters, setting, and tone from the original story
5. Structure the episode with clear scene breaks and visual descriptions
6. Length should be approximately 1500-2500 words
7. Include dramatic moments and cliffhangers appropriate for episodic content
8. Ensure the content flows well for visual manga storytelling

EPISODE STRUCTURE:
- Start with a compelling opening that connects to the previous content
- Include 3-5 distinct scenes with clear transitions
- Build tension and include character development
- End with a hook or resolution that sets up future episodes
- Use [Scene Break] to indicate major scene transitions
- Include panel descriptions in brackets [like this] to guide visual layout

FORMATTING:
- Start with a clear episode title
- Use proper paragraph breaks for readability
- Include dialogue in quotation marks
- Add scene descriptions that would work well with manga panels
- Use action lines and visual cues appropriate for manga format

Please generate Episode ${episodeNumber} now:`;
  }

  /**
   * Build the episode generation prompt with user preferences context
   */
  private buildEpisodePromptWithPreferences(
    storyContent: string,
    episodeNumber: number,
    storyTitle: string,
    userPreferences?: UserPreferencesData
  ): string {
    // Extract key elements from the story for context
    const storyLines = storyContent.split("\n");
    const storyPreview = storyLines.slice(0, 50).join("\n"); // First 50 lines for context

    // Build preferences context if available
    const preferencesContext = userPreferences
      ? `
USER PREFERENCES CONTEXT:
- Genres: ${userPreferences.genres?.join(", ") || "Not specified"}
- Themes: ${userPreferences.themes?.join(", ") || "Not specified"}
- Art Style: ${userPreferences.artStyle || "Not specified"}
- Target Audience: ${userPreferences.targetAudience || "Not specified"}
- Content Rating: ${userPreferences.contentRating || "Not specified"}

Please ensure the episode content aligns with these user preferences while maintaining story consistency.
`
      : `
USER PREFERENCES CONTEXT:
No specific user preferences available. Generate content that maintains consistency with the original story.
`;

    return `You are a skilled manga episode writer. Based on the provided story content and user preferences, create Episode ${episodeNumber} that continues the narrative in an engaging way suitable for manga format.

STORY CONTEXT:
Title: ${storyTitle}
Story Content Preview:
${storyPreview}

${
  storyContent.length > storyPreview.length
    ? `\n[Story continues with ${storyLines.length - 50} more lines...]\n`
    : ""
}

${preferencesContext}

EPISODE REQUIREMENTS:
1. Create Episode ${episodeNumber} that naturally continues from the story
2. The episode should be self-contained but part of the larger narrative
3. Include engaging dialogue and action sequences suitable for manga panels
4. Maintain consistency with characters, setting, and tone from the original story
5. Structure the episode with clear scene breaks and visual descriptions
6. Length should be approximately 1500-2500 words
7. Include dramatic moments and cliffhangers appropriate for episodic content
8. Ensure the content flows well for visual manga storytelling
9. Incorporate user preferences where appropriate without breaking story continuity

EPISODE STRUCTURE:
- Start with a compelling opening that connects to the previous content
- Include 3-5 distinct scenes with clear transitions
- Build tension and include character development
- End with a hook or resolution that sets up future episodes
- Use [Scene Break] to indicate major scene transitions
- Include panel descriptions in brackets [like this] to guide visual layout

FORMATTING:
- Start with a clear episode title
- Use proper paragraph breaks for readability
- Include dialogue in quotation marks
- Add scene descriptions that would work well with manga panels
- Use action lines and visual cues appropriate for manga format

Please generate Episode ${episodeNumber} now:`;
  }

  /**
   * Validate that the generated episode content meets basic requirements
   */
  private validateGeneratedContent(
    content: string,
    episodeNumber: number
  ): boolean {
    // Basic validation checks
    if (content.length < 300) {
      console.warn("Generated episode content is too short", {
        length: content.length,
        episodeNumber,
      });
      return false;
    }

    if (content.length > 8000) {
      console.warn("Generated episode content is too long", {
        length: content.length,
        episodeNumber,
      });
      return false;
    }

    // Check for basic episode structure
    const hasDialogue = content.includes('"') || content.includes("'");
    const hasSceneBreaks =
      content.includes("[Scene Break]") || content.includes("\n\n");

    if (!hasDialogue) {
      console.warn("Episode content lacks dialogue", { episodeNumber });
      // Don't fail validation, just warn
    }

    if (!hasSceneBreaks) {
      console.warn("Episode content lacks scene structure", { episodeNumber });
      // Don't fail validation, just warn
    }

    return true;
  }

  /**
   * Retry episode generation with modified parameters if needed
   */
  async generateEpisodeWithRetry(
    storyContent: string,
    episodeNumber: number,
    storyTitle: string,
    maxRetries: number = 2
  ): Promise<BedrockResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await this.generateEpisode(
          storyContent,
          episodeNumber,
          storyTitle
        );

        // Validate the generated content
        if (this.validateGeneratedContent(result.content, episodeNumber)) {
          return result;
        } else {
          throw new Error("Generated episode content failed validation checks");
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        console.warn(`Episode generation attempt ${attempt} failed`, {
          error: lastError.message,
          attempt,
          maxRetries: maxRetries + 1,
          episodeNumber,
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

    throw lastError || new Error("Episode generation failed after all retries");
  }

  /**
   * Generate multiple episodes in sequence
   */
  async generateMultipleEpisodes(
    storyContent: string,
    startEpisode: number,
    endEpisode: number,
    storyTitle: string
  ): Promise<BedrockResponse[]> {
    const results: BedrockResponse[] = [];

    for (
      let episodeNum = startEpisode;
      episodeNum <= endEpisode;
      episodeNum++
    ) {
      try {
        console.log(`Generating episode ${episodeNum} of ${endEpisode}`);

        const result = await this.generateEpisodeWithRetry(
          storyContent,
          episodeNum,
          storyTitle
        );

        results.push(result);

        // Add a small delay between episodes to avoid rate limiting
        if (episodeNum < endEpisode) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to generate episode ${episodeNum}`, {
          error: error instanceof Error ? error.message : String(error),
          episodeNumber: episodeNum,
        });

        // Continue with other episodes even if one fails
        results.push({
          content: `Error generating episode ${episodeNum}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          usage: undefined,
        });
      }
    }

    return results;
  }
}
