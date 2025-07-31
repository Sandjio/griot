import { BedrockClient } from "../bedrock-client";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

// Mock AWS SDK
jest.mock("@aws-sdk/client-bedrock-runtime");

const mockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<
  typeof BedrockRuntimeClient
>;
const mockInvokeModelCommand = InvokeModelCommand as jest.MockedClass<
  typeof InvokeModelCommand
>;

describe("BedrockClient", () => {
  let bedrockClient: BedrockClient;
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn();
    mockBedrockRuntimeClient.mockImplementation(
      () =>
        ({
          send: mockSend,
        } as any)
    );

    bedrockClient = new BedrockClient();
  });

  describe("generateEpisode", () => {
    const mockStoryContent = "# Test Story\n\nThis is a test story content.";
    const episodeNumber = 1;
    const storyTitle = "Test Story";

    it("should generate episode successfully", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "# Episode 1: The Beginning\n\nThis is the generated episode content.",
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

      const result = await bedrockClient.generateEpisode(
        mockStoryContent,
        episodeNumber,
        storyTitle
      );

      expect(result).toEqual({
        content:
          "# Episode 1: The Beginning\n\nThis is the generated episode content.",
        usage: {
          inputTokens: 150,
          outputTokens: 300,
        },
      });

      expect(mockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));
      expect(mockInvokeModelCommand).toHaveBeenCalledWith({
        modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
        body: expect.stringContaining("Episode 1"),
        contentType: "application/json",
        accept: "application/json",
      });
    });

    it("should handle response without usage information", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "Episode content without usage info.",
              },
            ],
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      const result = await bedrockClient.generateEpisode(
        mockStoryContent,
        episodeNumber,
        storyTitle
      );

      expect(result).toEqual({
        content: "Episode content without usage info.",
        usage: undefined,
      });
    });

    it("should throw error when no response body", async () => {
      mockSend.mockResolvedValue({});

      await expect(
        bedrockClient.generateEpisode(
          mockStoryContent,
          episodeNumber,
          storyTitle
        )
      ).rejects.toThrow("No response body received from Bedrock");
    });

    it("should throw error for invalid response format", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            invalid: "response",
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      await expect(
        bedrockClient.generateEpisode(
          mockStoryContent,
          episodeNumber,
          storyTitle
        )
      ).rejects.toThrow("Invalid response format from Bedrock");
    });

    it("should handle throttling error", async () => {
      mockSend.mockRejectedValue(new Error("throttling detected"));

      await expect(
        bedrockClient.generateEpisode(
          mockStoryContent,
          episodeNumber,
          storyTitle
        )
      ).rejects.toThrow(
        "Bedrock service is currently throttled. Please try again later."
      );
    });

    it("should handle content filter error", async () => {
      mockSend.mockRejectedValue(new Error("content filter violation"));

      await expect(
        bedrockClient.generateEpisode(
          mockStoryContent,
          episodeNumber,
          storyTitle
        )
      ).rejects.toThrow(
        "Generated content was filtered. Please adjust the story content and try again."
      );
    });

    it("should handle model not found error", async () => {
      mockSend.mockRejectedValue(new Error("model not found"));

      await expect(
        bedrockClient.generateEpisode(
          mockStoryContent,
          episodeNumber,
          storyTitle
        )
      ).rejects.toThrow(
        "The specified Bedrock model is not available in this region."
      );
    });

    it("should handle generic error", async () => {
      mockSend.mockRejectedValue(new Error("Generic error"));

      await expect(
        bedrockClient.generateEpisode(
          mockStoryContent,
          episodeNumber,
          storyTitle
        )
      ).rejects.toThrow("Failed to generate episode content: Generic error");
    });
  });

  describe("generateEpisodeWithRetry", () => {
    const mockStoryContent = "Test story content";
    const episodeNumber = 1;
    const storyTitle = "Test Story";

    it("should succeed on first attempt", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "Valid episode content with sufficient length to pass validation. This content is long enough to meet the minimum requirements for episode generation and includes proper structure and formatting that would be suitable for manga episodes. The content should have dialogue and scene descriptions that work well for visual storytelling.",
              },
            ],
            usage: {
              input_tokens: 100,
              output_tokens: 200,
            },
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      const result = await bedrockClient.generateEpisodeWithRetry(
        mockStoryContent,
        episodeNumber,
        storyTitle
      );

      expect(result.content).toContain("Valid episode content");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should retry on transient error", async () => {
      // First call fails, second succeeds
      mockSend
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(
            JSON.stringify({
              content: [
                {
                  text: "Valid episode content with sufficient length to pass validation after retry. This content is long enough to meet the minimum requirements for episode generation and includes proper structure and formatting that would be suitable for manga episodes. The content should have dialogue and scene descriptions that work well for visual storytelling.",
                },
              ],
              usage: {
                input_tokens: 100,
                output_tokens: 200,
              },
            })
          ),
        });

      const result = await bedrockClient.generateEpisodeWithRetry(
        mockStoryContent,
        episodeNumber,
        storyTitle,
        1 // maxRetries
      );

      expect(result.content).toContain("after retry");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should not retry on content filter error", async () => {
      mockSend.mockRejectedValue(new Error("content filter violation"));

      await expect(
        bedrockClient.generateEpisodeWithRetry(
          mockStoryContent,
          episodeNumber,
          storyTitle,
          2
        )
      ).rejects.toThrow("Generated content was filtered");

      // Should not retry on content filter errors, so only 1 call expected
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should fail after max retries", async () => {
      mockSend.mockRejectedValue(new Error("Persistent error"));

      await expect(
        bedrockClient.generateEpisodeWithRetry(
          mockStoryContent,
          episodeNumber,
          storyTitle,
          2
        )
      ).rejects.toThrow("Persistent error");

      expect(mockSend).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("should retry on validation failure", async () => {
      // First response too short, second response valid
      mockSend
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(
            JSON.stringify({
              content: [{ text: "Short" }],
              usage: { input_tokens: 10, output_tokens: 5 },
            })
          ),
        })
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(
            JSON.stringify({
              content: [
                {
                  text: "This is a much longer episode content that should pass validation checks and provide sufficient detail for manga storytelling. The content includes proper structure, dialogue, and scene descriptions that would work well for visual manga format. This ensures the episode meets all quality requirements.",
                },
              ],
              usage: { input_tokens: 100, output_tokens: 200 },
            })
          ),
        });

      const result = await bedrockClient.generateEpisodeWithRetry(
        mockStoryContent,
        episodeNumber,
        storyTitle,
        1
      );

      expect(result.content).toContain("longer episode content");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("generateMultipleEpisodes", () => {
    const mockStoryContent = "Test story content";
    const storyTitle = "Test Story";

    it("should generate multiple episodes successfully", async () => {
      const mockResponse1 = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "Episode 1 content with sufficient length for validation and proper structure for manga storytelling. This content includes dialogue, scene descriptions, and narrative elements that would work well in a visual format. The episode has enough detail to engage readers.",
              },
            ],
            usage: { input_tokens: 100, output_tokens: 200 },
          })
        ),
      };

      const mockResponse2 = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "Episode 2 content with sufficient length for validation and proper structure for manga storytelling. This content includes dialogue, scene descriptions, and narrative elements that would work well in a visual format. The episode has enough detail to engage readers.",
              },
            ],
            usage: { input_tokens: 110, output_tokens: 210 },
          })
        ),
      };

      // Mock all calls to return successful responses
      mockSend.mockResolvedValue(mockResponse1);
      mockSend.mockResolvedValueOnce(mockResponse1);
      mockSend.mockResolvedValueOnce(mockResponse2);

      const results = await bedrockClient.generateMultipleEpisodes(
        mockStoryContent,
        1,
        2,
        storyTitle
      );

      expect(results).toHaveLength(2);
      expect(results[0].content).toContain("Episode 1 content");
      expect(results[1].content).toContain("Episode 2 content");
    });

    it("should continue with other episodes if one fails", async () => {
      const mockResponse1 = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "Episode 1 content with sufficient length for validation and proper structure for manga storytelling. This content includes dialogue, scene descriptions, and narrative elements that would work well in a visual format. The episode has enough detail to engage readers.",
              },
            ],
            usage: { input_tokens: 100, output_tokens: 200 },
          })
        ),
      };

      // First episode succeeds, second fails
      mockSend
        .mockResolvedValueOnce(mockResponse1)
        .mockRejectedValue(new Error("Episode 2 failed"));

      const results = await bedrockClient.generateMultipleEpisodes(
        mockStoryContent,
        1,
        2,
        storyTitle
      );

      expect(results).toHaveLength(2);
      expect(results[0].content).toContain("Episode 1 content");
      expect(results[1].content).toContain("Error generating episode 2");
    });
  });

  describe("buildEpisodePrompt", () => {
    it("should build prompt with story context", async () => {
      const mockStoryContent = "# Test Story\n\nThis is a test story.";
      const episodeNumber = 1;
      const storyTitle = "Test Story";

      // Access private method through any cast for testing
      const prompt = (bedrockClient as any).buildEpisodePrompt(
        mockStoryContent,
        episodeNumber,
        storyTitle
      );

      expect(prompt).toContain("Episode 1");
      expect(prompt).toContain("Test Story");
      expect(prompt).toContain("This is a test story.");
      expect(prompt).toContain("manga episode writer");
      expect(prompt).toContain("EPISODE REQUIREMENTS");
    });

    it("should handle long story content", async () => {
      const longStoryContent = Array(100)
        .fill("This is line content.")
        .join("\n");
      const episodeNumber = 2;
      const storyTitle = "Long Story";

      const prompt = (bedrockClient as any).buildEpisodePrompt(
        longStoryContent,
        episodeNumber,
        storyTitle
      );

      expect(prompt).toContain("Episode 2");
      expect(prompt).toContain("Long Story");
      expect(prompt).toContain("[Story continues with");
    });
  });

  describe("validateGeneratedContent", () => {
    it("should validate content length", () => {
      const shortContent = "Too short";
      const validContent =
        "This is a valid episode content with sufficient length to pass validation checks and provide good value for manga storytelling. It includes proper structure and formatting that would be suitable for manga episodes with dialogue and scene descriptions.";
      const longContent = "x".repeat(9000);

      expect(
        (bedrockClient as any).validateGeneratedContent(shortContent, 1)
      ).toBe(false);
      expect(
        (bedrockClient as any).validateGeneratedContent(validContent, 1)
      ).toBe(true);
      expect(
        (bedrockClient as any).validateGeneratedContent(longContent, 1)
      ).toBe(false);
    });

    it("should warn about missing dialogue and scene breaks", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      // Use longer content that passes length validation but lacks dialogue/scenes
      const contentWithoutDialogue =
        "This content has no dialogue at all and is long enough to pass the basic length validation checks. It contains sufficient text to meet the minimum requirements but lacks the dialogue elements that would make it suitable for manga storytelling format.";
      const contentWithoutScenes =
        'This content has "dialogue" but no scene breaks and is long enough to pass the basic length validation checks. It contains sufficient text to meet the minimum requirements but lacks proper scene structure.';

      (bedrockClient as any).validateGeneratedContent(
        contentWithoutDialogue,
        1
      );
      (bedrockClient as any).validateGeneratedContent(contentWithoutScenes, 1);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Episode content lacks dialogue",
        { episodeNumber: 1 }
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "Episode content lacks scene structure",
        { episodeNumber: 1 }
      );

      consoleSpy.mockRestore();
    });
  });

  describe("generateEpisodeWithPreferences", () => {
    const mockStoryContent = "# Test Story\n\nThis is a test story content.";
    const episodeNumber = 2;
    const storyTitle = "Test Story";
    const mockUserPreferences = {
      genres: ["Action", "Adventure"],
      themes: ["Friendship", "Growth"],
      artStyle: "Manga",
      targetAudience: "Teen",
      contentRating: "PG-13",
    };

    it("should generate episode with preferences successfully", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "# Episode 2: The Adventure Continues\n\nThis episode incorporates user preferences for action and adventure themes.",
              },
            ],
            usage: {
              input_tokens: 200,
              output_tokens: 350,
            },
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      const result = await bedrockClient.generateEpisodeWithPreferences(
        mockStoryContent,
        episodeNumber,
        storyTitle,
        mockUserPreferences
      );

      expect(result).toEqual({
        content:
          "# Episode 2: The Adventure Continues\n\nThis episode incorporates user preferences for action and adventure themes.",
        usage: {
          inputTokens: 200,
          outputTokens: 350,
        },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockInvokeModelCommand).toHaveBeenCalledWith({
        modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
        body: expect.stringContaining("Action, Adventure"),
        contentType: "application/json",
        accept: "application/json",
      });
    });

    it("should generate episode without preferences when none provided", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "# Episode 2: The Journey\n\nThis episode maintains story consistency without specific preferences.",
              },
            ],
            usage: {
              input_tokens: 180,
              output_tokens: 320,
            },
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      const result = await bedrockClient.generateEpisodeWithPreferences(
        mockStoryContent,
        episodeNumber,
        storyTitle,
        undefined
      );

      expect(result).toEqual({
        content:
          "# Episode 2: The Journey\n\nThis episode maintains story consistency without specific preferences.",
        usage: {
          inputTokens: 180,
          outputTokens: 320,
        },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockInvokeModelCommand).toHaveBeenCalledWith({
        modelId: "anthropic.claude-3-sonnet-20240229-v1:0",
        body: expect.stringContaining("No specific user preferences available"),
        contentType: "application/json",
        accept: "application/json",
      });
    });

    it("should handle Bedrock errors for preferences-based generation", async () => {
      const mockError = new Error("Bedrock preferences error");
      mockSend.mockRejectedValue(mockError);

      await expect(
        bedrockClient.generateEpisodeWithPreferences(
          mockStoryContent,
          episodeNumber,
          storyTitle,
          mockUserPreferences
        )
      ).rejects.toThrow(
        "Failed to generate episode content with preferences: Bedrock preferences error"
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should handle throttling errors for preferences-based generation", async () => {
      const mockError = new Error("throttling error occurred");
      mockSend.mockRejectedValue(mockError);

      await expect(
        bedrockClient.generateEpisodeWithPreferences(
          mockStoryContent,
          episodeNumber,
          storyTitle,
          mockUserPreferences
        )
      ).rejects.toThrow(
        "Bedrock service is currently throttled. Please try again later."
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should handle content filter errors for preferences-based generation", async () => {
      const mockError = new Error("content filter violation");
      mockSend.mockRejectedValue(mockError);

      await expect(
        bedrockClient.generateEpisodeWithPreferences(
          mockStoryContent,
          episodeNumber,
          storyTitle,
          mockUserPreferences
        )
      ).rejects.toThrow(
        "Generated content was filtered. Please adjust the story content and try again."
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should include preferences context in prompt", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: "# Episode 2: Action-Packed Adventure\n\nThis episode follows the user's preference for action and adventure.",
              },
            ],
            usage: {
              input_tokens: 220,
              output_tokens: 380,
            },
          })
        ),
      };

      mockSend.mockResolvedValue(mockResponse);

      await bedrockClient.generateEpisodeWithPreferences(
        mockStoryContent,
        episodeNumber,
        storyTitle,
        mockUserPreferences
      );

      // Verify that the prompt includes user preferences
      const callArgs = mockInvokeModelCommand.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.body);
      const prompt = requestBody.messages[0].content;

      expect(prompt).toContain("USER PREFERENCES CONTEXT:");
      expect(prompt).toContain("Action, Adventure");
      expect(prompt).toContain("Friendship, Growth");
      expect(prompt).toContain("Manga");
      expect(prompt).toContain("Teen");
      expect(prompt).toContain("PG-13");
      expect(prompt).toContain(
        "Please ensure the episode content aligns with these user preferences"
      );
    });
  });
});
