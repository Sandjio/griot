import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Amazon Bedrock Client for Image Generation
 *
 * Integrates with Amazon Bedrock to generate manga-style images
 * using Stable Diffusion XL model based on scene descriptions.
 */
export class BedrockImageClient {
  private client: BedrockRuntimeClient;
  private modelId: string;

  constructor() {
    this.client = new BedrockRuntimeClient({
      region:
        process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1",
    });
    this.modelId = "stability.stable-diffusion-xl-v1";
  }

  /**
   * Generate image based on scene description
   */
  async generateImage(
    prompt: string,
    style: string = "manga style"
  ): Promise<{
    imageData: Buffer;
    prompt: string;
  }> {
    const enhancedPrompt = this.enhancePromptForManga(prompt, style);

    console.log("Generating image with Bedrock", {
      modelId: this.modelId,
      promptLength: enhancedPrompt.length,
      originalPrompt: prompt.substring(0, 100) + "...",
      enhancedPrompt: enhancedPrompt,
    });

    try {
      const requestBody = {
        text_prompts: [
          {
            text: enhancedPrompt,
            weight: 1,
          },
          {
            text: this.getNegativePrompt(),
            weight: -1,
          },
        ],
        cfg_scale: 7,
        seed: Math.floor(Math.random() * 1000000),
        steps: 20,
        width: 512,
        height: 512,
        samples: 1,
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
        !responseBody.artifacts ||
        !responseBody.artifacts[0] ||
        !responseBody.artifacts[0].base64
      ) {
        throw new Error(
          "Invalid response format from Bedrock image generation"
        );
      }

      const base64Image = responseBody.artifacts[0].base64;
      const imageData = Buffer.from(base64Image, "base64");

      console.log("Successfully generated image", {
        imageSize: imageData.length,
        promptLength: enhancedPrompt.length,
      });

      return {
        imageData,
        prompt: enhancedPrompt,
      };
    } catch (error) {
      console.error("Error generating image with Bedrock", {
        error: error instanceof Error ? error.message : String(error),
        modelId: this.modelId,
        promptLength: enhancedPrompt.length,
      });

      // Handle specific Bedrock errors
      if (error instanceof Error) {
        if (error.message.includes("throttling")) {
          throw new Error(
            "Bedrock image generation service is currently throttled. Please try again later."
          );
        }
        if (error.message.includes("content filter")) {
          throw new Error(
            "Image prompt was filtered. Please adjust the content and try again."
          );
        }
        if (error.message.includes("model not found")) {
          throw new Error(
            "The specified Bedrock image model is not available in this region."
          );
        }
        if (error.message.includes("invalid prompt")) {
          throw new Error(
            "The image generation prompt is invalid or too long."
          );
        }
      }

      throw new Error(
        `Failed to generate image: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Generate multiple images with retry logic
   */
  async generateImageWithRetry(
    prompt: string,
    style: string = "manga style",
    maxRetries: number = 2
  ): Promise<{
    imageData: Buffer;
    prompt: string;
  }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await this.generateImage(prompt, style);

        // Validate the generated image
        if (this.validateGeneratedImage(result.imageData)) {
          return result;
        } else {
          throw new Error("Generated image failed validation checks");
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        console.warn(`Image generation attempt ${attempt} failed`, {
          error: lastError.message,
          attempt,
          maxRetries: maxRetries + 1,
          promptLength: prompt.length,
        });

        // Don't retry on certain errors
        if (
          lastError.message.includes("content filter") ||
          lastError.message.includes("model not found") ||
          lastError.message.includes("invalid prompt")
        ) {
          throw lastError;
        }

        // Wait before retry (exponential backoff)
        if (attempt <= maxRetries) {
          const waitTime = Math.pow(2, attempt - 1) * 2000; // 2s, 4s, 8s...
          console.log(`Waiting ${waitTime}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    throw lastError || new Error("Image generation failed after all retries");
  }

  /**
   * Enhance prompt for manga-style image generation
   */
  private enhancePromptForManga(prompt: string, style: string): string {
    // Start with a very clean base prompt
    let cleanPrompt = prompt.trim();

    // Remove any potentially problematic characters that Stability AI doesn't like
    cleanPrompt = cleanPrompt
      .replace(/['"]/g, "") // Remove quotes
      .replace(/[:;]/g, "") // Remove colons and semicolons
      .replace(/[{}[\]]/g, "") // Remove brackets
      .replace(/[#*_]/g, "") // Remove markdown
      .replace(/\s+/g, " ") // Normalize spaces
      .trim();

    // Keep it simple and short - Stability AI prefers concise prompts
    if (cleanPrompt.length > 200) {
      cleanPrompt = cleanPrompt.substring(0, 200).trim();
      // Don't cut mid-word
      const lastSpace = cleanPrompt.lastIndexOf(" ");
      if (lastSpace > 150) {
        cleanPrompt = cleanPrompt.substring(0, lastSpace);
      }
    }

    // Create a simple, safe prompt format
    const safePrompt = `${cleanPrompt}, manga style, black and white, detailed line art`;

    return safePrompt;
  }

  /**
   * Get negative prompt to avoid unwanted elements
   */
  private getNegativePrompt(): string {
    return [
      "blurry",
      "low quality",
      "distorted",
      "ugly",
      "bad anatomy",
      "extra limbs",
      "malformed",
      "text",
      "watermark",
      "signature",
      "logo",
      "copyright",
      "nsfw",
      "explicit",
      "violence",
      "gore",
      "inappropriate content",
      "color",
      "colored",
      "rainbow",
      "bright colors",
    ].join(", ");
  }

  /**
   * Validate that the generated image meets basic requirements
   */
  private validateGeneratedImage(imageData: Buffer): boolean {
    // Basic validation checks
    if (imageData.length < 1000) {
      console.warn("Generated image is too small", {
        size: imageData.length,
      });
      return false;
    }

    if (imageData.length > 10 * 1024 * 1024) {
      // 10MB limit
      console.warn("Generated image is too large", {
        size: imageData.length,
      });
      return false;
    }

    // Check if it's a valid PNG by looking at the header
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (!imageData.subarray(0, 8).equals(pngHeader)) {
      console.warn("Generated image is not a valid PNG");
      return false;
    }

    return true;
  }

  /**
   * Generate batch of images for multiple scenes
   */
  async generateBatchImages(
    scenes: Array<{ description: string; style?: string }>
  ): Promise<
    Array<{
      imageIndex: number;
      imageData: Buffer;
      prompt: string;
      success: boolean;
      error?: string;
    }>
  > {
    const results: Array<{
      imageIndex: number;
      imageData: Buffer;
      prompt: string;
      success: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imageIndex = i + 1;

      try {
        console.log(`Generating batch image ${imageIndex} of ${scenes.length}`);

        const result = await this.generateImageWithRetry(
          scene.description,
          scene.style || "manga style"
        );

        results.push({
          imageIndex,
          imageData: result.imageData,
          prompt: result.prompt,
          success: true,
        });

        // Add delay between batch generations
        if (i < scenes.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (error) {
        console.error(`Failed to generate batch image ${imageIndex}`, {
          error: error instanceof Error ? error.message : String(error),
          imageIndex,
        });

        results.push({
          imageIndex,
          imageData: Buffer.alloc(0),
          prompt: scene.description,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Generate image variations for A/B testing
   */
  async generateImageVariations(
    prompt: string,
    variationCount: number = 2,
    style: string = "manga style"
  ): Promise<
    Array<{
      variationIndex: number;
      imageData: Buffer;
      prompt: string;
    }>
  > {
    const variations: Array<{
      variationIndex: number;
      imageData: Buffer;
      prompt: string;
    }> = [];

    for (let i = 0; i < variationCount; i++) {
      try {
        console.log(`Generating variation ${i + 1} of ${variationCount}`);

        const result = await this.generateImage(prompt, style);

        variations.push({
          variationIndex: i + 1,
          imageData: result.imageData,
          prompt: result.prompt,
        });

        // Add delay between variations
        if (i < variationCount - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`Failed to generate variation ${i + 1}`, {
          error: error instanceof Error ? error.message : String(error),
          variationIndex: i + 1,
        });

        // Continue with other variations even if one fails
        continue;
      }
    }

    return variations;
  }
}
