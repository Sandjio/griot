import { BedrockClient } from "../bedrock-client";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { UserPreferencesData, QlooInsights } from "../../../types/data-models";

// Mock the AWS SDK
jest.mock("@aws-sdk/client-bedrock-runtime");

const mockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<
  typeof BedrockRuntimeClient
>;
const mockSend = jest.fn();

describe("BedrockClient", () => {
  let bedrockClient: BedrockClient;

  const mockPreferences: UserPreferencesData = {
    genres: ["Action", "Adventure"],
    themes: ["Friendship", "Growth"],
    artStyle: "Shonen",
    targetAudience: "Teen",
    contentRating: "PG-13",
  };

  const mockInsights: QlooInsights = {
    recommendations: [
      { category: "Action", score: 0.9, attributes: {} },
      { category: "Adventure", score: 0.8, attributes: {} },
    ],
    trends: [
      { topic: "Friendship", popularity: 0.95 },
      { topic: "Growth", popularity: 0.85 },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock the BedrockRuntimeClient constructor and send method
    mockBedrockRuntimeClient.mockImplementation(
      () =>
        ({
          send: mockSend,
        } as any)
    );

    bedrockClient = new BedrockClient();
  });

  describe("generateStory", () => {
    it("should successfully generate story content", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "# Epic Adventure\n\nThis is a story about friendship and growth in a world of action and adventure...",
              },
            ],
            usage: {
              input_tokens: 150,
              output_tokens: 300,
            },
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      const result = await bedrockClient.generateStory(
        mockPreferences,
        mockInsights
      );

      expect(result).toEqual({
        content:
          "# Epic Adventure\n\nThis is a story about friendship and growth in a world of action and adventure...",
        usage: {
          inputTokens: 150,
          outputTokens: 300,
        },
      });

      // Verify the correct model and parameters were used
      expect(mockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));

      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.modelId).toBe("anthropic.claude-3-sonnet-20240229-v1:0");
      expect(callArgs.contentType).toBe("application/json");
      expect(callArgs.accept).toBe("application/json");

      const requestBody = JSON.parse(callArgs.body);
      expect(requestBody.anthropic_version).toBe("bedrock-2023-05-31");
      expect(requestBody.max_tokens).toBe(4000);
      expect(requestBody.temperature).toBe(0.7);
      expect(requestBody.messages).toHaveLength(1);
      expect(requestBody.messages[0].role).toBe("user");
      expect(requestBody.messages[0].content).toContain("manga story");
    });

    it("should build comprehensive prompt with preferences and insights", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Generated story content" }],
            usage: { input_tokens: 100, output_tokens: 200 },
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      await bedrockClient.generateStory(mockPreferences, mockInsights);

      const callArgs = mockSend.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.body);
      const prompt = requestBody.messages[0].content;

      // Verify prompt includes user preferences
      expect(prompt).toContain("Action, Adventure");
      expect(prompt).toContain("Friendship, Growth");
      expect(prompt).toContain("Shonen");
      expect(prompt).toContain("Teen");
      expect(prompt).toContain("PG-13");

      // Verify prompt includes insights
      expect(prompt).toContain("Action, Adventure"); // Popular categories
      expect(prompt).toContain("Friendship, Growth"); // Trending topics

      // Verify prompt includes story requirements
      expect(prompt).toContain("2000-3000 words");
      expect(prompt).toContain("manga format");
      expect(prompt).toContain("clear title");
    });

    it("should handle response without usage information", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Story without usage info" }],
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      const result = await bedrockClient.generateStory(
        mockPreferences,
        mockInsights
      );

      expect(result).toEqual({
        content: "Story without usage info",
        usage: undefined,
      });
    });

    it("should handle empty response body", async () => {
      const mockResponse = { body: null };
      mockSend.mockResolvedValue(mockResponse);

      await expect(
        bedrockClient.generateStory(mockPreferences, mockInsights)
      ).rejects.toThrow("No response body received from Bedrock");
    });

    it("should handle invalid response format", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            invalid: "response format",
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      await expect(
        bedrockClient.generateStory(mockPreferences, mockInsights)
      ).rejects.toThrow("Invalid response format from Bedrock");
    });

    it("should handle throttling errors", async () => {
      const throttlingError = new Error("Request was throttled");
      throttlingError.message = "throttling detected";
      mockSend.mockRejectedValue(throttlingError);

      await expect(
        bedrockClient.generateStory(mockPreferences, mockInsights)
      ).rejects.toThrow("Bedrock service is currently throttled");
    });

    it("should handle content filter errors", async () => {
      const contentFilterError = new Error("Content filtered");
      contentFilterError.message = "content filter violation";
      mockSend.mockRejectedValue(contentFilterError);

      await expect(
        bedrockClient.generateStory(mockPreferences, mockInsights)
      ).rejects.toThrow("Generated content was filtered");
    });

    it("should handle model not found errors", async () => {
      const modelError = new Error("Model not available");
      modelError.message = "model not found in region";
      mockSend.mockRejectedValue(modelError);

      await expect(
        bedrockClient.generateStory(mockPreferences, mockInsights)
      ).rejects.toThrow("The specified Bedrock model is not available");
    });

    it("should handle generic errors", async () => {
      const genericError = new Error("Unknown error");
      mockSend.mockRejectedValue(genericError);

      await expect(
        bedrockClient.generateStory(mockPreferences, mockInsights)
      ).rejects.toThrow("Failed to generate story content: Unknown error");
    });
  });

  describe("generateStoryWithRetry", () => {
    it("should succeed on first attempt", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text:
                  "# Great Story\n\nThis is a long enough story content that passes validation..." +
                  "x".repeat(500),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 200 },
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      const result = await bedrockClient.generateStoryWithRetry(
        mockPreferences,
        mockInsights
      );

      expect(result.content).toContain("Great Story");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should retry on transient failures", async () => {
      const transientError = new Error("Network timeout");
      const successResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text:
                  "# Retry Success\n\nThis story was generated after retry..." +
                  "x".repeat(500),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 200 },
          })
        ),
      };

      mockSend
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(successResponse);

      const result = await bedrockClient.generateStoryWithRetry(
        mockPreferences,
        mockInsights,
        2
      );

      expect(result.content).toContain("Retry Success");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should not retry on content filter errors", async () => {
      const contentFilterError = new Error("content filter violation");
      mockSend.mockRejectedValue(contentFilterError);

      await expect(
        bedrockClient.generateStoryWithRetry(mockPreferences, mockInsights, 2)
      ).rejects.toThrow("Generated content was filtered");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should not retry on model not found errors", async () => {
      const modelError = new Error("model not found");
      mockSend.mockRejectedValue(modelError);

      await expect(
        bedrockClient.generateStoryWithRetry(mockPreferences, mockInsights, 2)
      ).rejects.toThrow("The specified Bedrock model is not available");

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should fail after max retries", async () => {
      const persistentError = new Error("Persistent failure");
      mockSend.mockRejectedValue(persistentError);

      await expect(
        bedrockClient.generateStoryWithRetry(mockPreferences, mockInsights, 2)
      ).rejects.toThrow("Failed to generate story content: Persistent failure");

      expect(mockSend).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should validate content length", async () => {
      const shortContentResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Too short" }],
            usage: { input_tokens: 10, output_tokens: 5 },
          })
        ),
      };

      const validContentResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text:
                  "# Valid Story\n\nThis is a properly sized story content..." +
                  "x".repeat(500),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 200 },
          })
        ),
      };

      mockSend
        .mockResolvedValueOnce(shortContentResponse)
        .mockResolvedValueOnce(validContentResponse);

      const result = await bedrockClient.generateStoryWithRetry(
        mockPreferences,
        mockInsights,
        2
      );

      expect(result.content).toContain("Valid Story");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should warn about inappropriate content for G rating", async () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

      const inappropriateContentResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text:
                  "# Story with Violence\n\nThis story contains violence and blood..." +
                  "x".repeat(500),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 200 },
          })
        ),
      };

      mockSend.mockResolvedValue(inappropriateContentResponse);

      const gRatedPreferences = { ...mockPreferences, contentRating: "G" };
      const result = await bedrockClient.generateStoryWithRetry(
        gRatedPreferences,
        mockInsights
      );

      expect(result.content).toContain("Story with Violence");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Content may not be appropriate for rating",
        expect.objectContaining({
          rating: "G",
          foundWord: "violence",
        })
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe("Environment configuration", () => {
    it("should use custom Bedrock region from environment", () => {
      const originalRegion = process.env.BEDROCK_REGION;
      process.env.BEDROCK_REGION = "eu-west-1";

      new BedrockClient();

      expect(mockBedrockRuntimeClient).toHaveBeenCalledWith({
        region: "eu-west-1",
      });

      // Restore original environment
      if (originalRegion) {
        process.env.BEDROCK_REGION = originalRegion;
      } else {
        delete process.env.BEDROCK_REGION;
      }
    });

    it("should fall back to AWS_REGION if BEDROCK_REGION not set", () => {
      const originalBedrockRegion = process.env.BEDROCK_REGION;
      const originalAwsRegion = process.env.AWS_REGION;

      delete process.env.BEDROCK_REGION;
      process.env.AWS_REGION = "ap-southeast-1";

      new BedrockClient();

      expect(mockBedrockRuntimeClient).toHaveBeenCalledWith({
        region: "ap-southeast-1",
      });

      // Restore original environment
      if (originalBedrockRegion) {
        process.env.BEDROCK_REGION = originalBedrockRegion;
      }
      if (originalAwsRegion) {
        process.env.AWS_REGION = originalAwsRegion;
      } else {
        delete process.env.AWS_REGION;
      }
    });

    it("should default to us-east-1 if no region environment variables", () => {
      const originalBedrockRegion = process.env.BEDROCK_REGION;
      const originalAwsRegion = process.env.AWS_REGION;

      delete process.env.BEDROCK_REGION;
      delete process.env.AWS_REGION;

      new BedrockClient();

      expect(mockBedrockRuntimeClient).toHaveBeenCalledWith({
        region: "us-east-1",
      });

      // Restore original environment
      if (originalBedrockRegion) {
        process.env.BEDROCK_REGION = originalBedrockRegion;
      }
      if (originalAwsRegion) {
        process.env.AWS_REGION = originalAwsRegion;
      }
    });
  });

  describe("Logging", () => {
    it("should log generation start and success", async () => {
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();

      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: "Generated story content" }],
            usage: { input_tokens: 100, output_tokens: 200 },
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      await bedrockClient.generateStory(mockPreferences, mockInsights);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Generating story with Bedrock",
        expect.objectContaining({
          modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
          promptLength: expect.any(Number),
          preferences: expect.objectContaining({
            genres: ["Action", "Adventure"],
            themes: ["Friendship", "Growth"],
          }),
        })
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Successfully generated story content",
        expect.objectContaining({
          contentLength: expect.any(Number),
          inputTokens: 100,
          outputTokens: 200,
        })
      );

      consoleLogSpy.mockRestore();
    });

    it("should log errors with context", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      const error = new Error("Test error");
      mockSend.mockRejectedValue(error);

      await expect(
        bedrockClient.generateStory(mockPreferences, mockInsights)
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error generating story with Bedrock",
        expect.objectContaining({
          error: "Test error",
          modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
        })
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
