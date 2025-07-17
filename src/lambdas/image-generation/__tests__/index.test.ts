import { handler } from "../index";
import { EventBridgeEvent } from "aws-lambda";
import { ImageGenerationEventDetail } from "../../../types/event-schemas";
import { EpisodeAccess } from "../../../database/access-patterns";
import { EventPublishingHelpers } from "../../../utils/event-publisher";
import { createMangaStorageService } from "../../../storage/manga-storage";
import { BedrockImageClient } from "../bedrock-client";
import { PDFGenerator } from "../pdf-generator";

// Mock dependencies
jest.mock("../../../database/access-patterns");
jest.mock("../../../utils/event-publisher");
jest.mock("../../../storage/manga-storage");
jest.mock("../bedrock-client");
jest.mock("../pdf-generator");

const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockEventPublishing = EventPublishingHelpers as jest.Mocked<
  typeof EventPublishingHelpers
>;
const mockCreateStorageService =
  createMangaStorageService as jest.MockedFunction<
    typeof createMangaStorageService
  >;
const mockBedrockImageClient = BedrockImageClient as jest.MockedClass<
  typeof BedrockImageClient
>;
const mockPDFGenerator = PDFGenerator as jest.MockedClass<typeof PDFGenerator>;

describe("Image Generation Lambda", () => {
  const mockEvent: EventBridgeEvent<
    "Image Generation Requested",
    ImageGenerationEventDetail
  > = {
    version: "0",
    id: "test-event-id",
    "detail-type": "Image Generation Requested",
    source: "manga.episode",
    account: "123456789012",
    time: "2024-01-01T00:00:00Z",
    region: "us-east-1",
    resources: [],
    detail: {
      userId: "user-123",
      episodeId: "episode-456",
      episodeS3Key: "episodes/user-123/story-789/1/episode.md",
      timestamp: "2024-01-01T00:00:00Z",
    },
  };

  const mockEpisode = {
    PK: "STORY#story-789",
    SK: "EPISODE#1",
    GSI1PK: "EPISODE#episode-456",
    GSI1SK: "METADATA",
    GSI2PK: "STATUS#COMPLETED",
    GSI2SK: "2024-01-01T00:00:00Z",
    episodeId: "episode-456",
    episodeNumber: 1,
    storyId: "story-789",
    s3Key: "episodes/user-123/story-789/1/episode.md",
    status: "COMPLETED" as const,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  const mockStorageService = {
    getEpisode: jest.fn(),
    saveImage: jest.fn(),
    saveEpisodePDF: jest.fn(),
  };

  const mockBedrockClient = {
    generateImage: jest.fn(),
  };

  const mockPdfGenerator = {
    createEpisodePDF: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateStorageService.mockReturnValue(mockStorageService as any);
    mockBedrockImageClient.mockImplementation(() => mockBedrockClient as any);
    mockPDFGenerator.mockImplementation(() => mockPdfGenerator as any);
  });

  describe("Input Validation", () => {
    it("should throw error for empty userId", async () => {
      const invalidEvent = {
        ...mockEvent,
        detail: { ...mockEvent.detail, userId: "" },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "User ID is required and cannot be empty"
      );
    });

    it("should throw error for empty episodeId", async () => {
      const invalidEvent = {
        ...mockEvent,
        detail: { ...mockEvent.detail, episodeId: "" },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "Episode ID is required and cannot be empty"
      );
    });

    it("should throw error for empty episodeS3Key", async () => {
      const invalidEvent = {
        ...mockEvent,
        detail: { ...mockEvent.detail, episodeS3Key: "" },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "Episode S3 key is required and cannot be empty"
      );
    });

    it("should throw error for invalid S3 key format", async () => {
      const invalidEvent = {
        ...mockEvent,
        detail: { ...mockEvent.detail, episodeS3Key: "invalid/key" },
      };

      await expect(handler(invalidEvent)).rejects.toThrow(
        "Invalid episode S3 key format"
      );
    });
  });

  describe("Episode Validation", () => {
    it("should throw error if episode not found", async () => {
      mockEpisodeAccess.get.mockResolvedValue(null);

      await expect(handler(mockEvent)).rejects.toThrow(
        "Episode not found: story-789/1"
      );
    });

    it("should throw error if episode not completed", async () => {
      mockEpisodeAccess.get.mockResolvedValue({
        ...mockEpisode,
        status: "PROCESSING",
      });

      await expect(handler(mockEvent)).rejects.toThrow(
        "Episode is not completed. Current status: PROCESSING"
      );
    });

    it("should skip processing if PDF already exists", async () => {
      mockEpisodeAccess.get.mockResolvedValue({
        ...mockEpisode,
        pdfS3Key: "episodes/user-123/story-789/1/episode.pdf",
      });

      await handler(mockEvent);

      expect(mockEventPublishing.publishStatusUpdate).toHaveBeenCalledWith(
        "user-123",
        "episode-456",
        "IMAGE",
        "COMPLETED",
        "episode-456"
      );
      expect(mockStorageService.getEpisode).not.toHaveBeenCalled();
    });
  });

  describe("Successful Image Generation", () => {
    const mockEpisodeContent = `# Episode 1: The Beginning

This is the first scene with some action.

[Scene Break]

This is the second scene with dialogue.
"Hello, world!" said the character.

[Scene Break]

This is the final scene with conclusion.`;

    const mockGeneratedImages = [
      {
        imageIndex: 1,
        imageData: Buffer.from("fake-image-data-1"),
        prompt: "Scene 1 description",
        filename: "image-001.png",
      },
      {
        imageIndex: 2,
        imageData: Buffer.from("fake-image-data-2"),
        prompt: "Scene 2 description",
        filename: "image-002.png",
      },
    ];

    const mockPDFBuffer = Buffer.from("fake-pdf-data");

    beforeEach(() => {
      mockEpisodeAccess.get.mockResolvedValue(mockEpisode);
      mockEpisodeAccess.updateStatus.mockResolvedValue();
      mockStorageService.getEpisode.mockResolvedValue(mockEpisodeContent);
      mockBedrockClient.generateImage
        .mockResolvedValueOnce({
          imageData: mockGeneratedImages[0].imageData,
          prompt: mockGeneratedImages[0].prompt,
        })
        .mockResolvedValueOnce({
          imageData: mockGeneratedImages[1].imageData,
          prompt: mockGeneratedImages[1].prompt,
        })
        .mockResolvedValueOnce({
          imageData: Buffer.from("fake-image-data-3"),
          prompt: "Scene 3 description",
        });
      mockStorageService.saveImage.mockResolvedValue({
        bucket: "test-bucket",
        key: "test-key",
      });
      mockPdfGenerator.createEpisodePDF.mockResolvedValue(mockPDFBuffer);
      mockStorageService.saveEpisodePDF.mockResolvedValue({
        bucket: "test-bucket",
        key: "episodes/user-123/story-789/1/episode.pdf",
      });
      mockEventPublishing.publishStatusUpdate.mockResolvedValue();
    });

    it("should successfully generate images and create PDF", async () => {
      await handler(mockEvent);

      // Verify episode status updates
      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-789",
        1,
        "PROCESSING",
        expect.objectContaining({
          imageGenerationStarted: expect.any(String),
        })
      );

      // Verify episode content fetched
      expect(mockStorageService.getEpisode).toHaveBeenCalledWith(
        "user-123",
        "story-789",
        1
      );

      // Verify images generated (3 scenes from the test content)
      expect(mockBedrockClient.generateImage).toHaveBeenCalledTimes(3);

      // Verify images saved
      expect(mockStorageService.saveImage).toHaveBeenCalledTimes(3);

      // Verify PDF created and saved
      expect(mockPdfGenerator.createEpisodePDF).toHaveBeenCalledWith(
        mockEpisodeContent,
        expect.arrayContaining([
          expect.objectContaining({
            imageIndex: 1,
            imageData: mockGeneratedImages[0].imageData,
          }),
          expect.objectContaining({
            imageIndex: 2,
            imageData: mockGeneratedImages[1].imageData,
          }),
        ]),
        {
          episodeId: "episode-456",
          episodeNumber: 1,
          storyId: "story-789",
          userId: "user-123",
        }
      );

      expect(mockStorageService.saveEpisodePDF).toHaveBeenCalledWith(
        "user-123",
        "story-789",
        1,
        mockPDFBuffer
      );

      // Verify final status update
      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-789",
        1,
        "COMPLETED",
        expect.objectContaining({
          pdfS3Key: "episodes/user-123/story-789/1/episode.pdf",
          imageCount: 3,
          imageGenerationCompleted: expect.any(String),
        })
      );

      // Verify completion event published
      expect(mockEventPublishing.publishStatusUpdate).toHaveBeenCalledWith(
        "user-123",
        "episode-456",
        "IMAGE",
        "COMPLETED",
        "episode-456"
      );
    });

    it("should handle partial image generation failure", async () => {
      // Mock first image success, second image failure
      mockBedrockClient.generateImage
        .mockResolvedValueOnce({
          imageData: mockGeneratedImages[0].imageData,
          prompt: mockGeneratedImages[0].prompt,
        })
        .mockRejectedValueOnce(new Error("Image generation failed"));

      await handler(mockEvent);

      // Should still create PDF with available images
      expect(mockPdfGenerator.createEpisodePDF).toHaveBeenCalledWith(
        mockEpisodeContent,
        expect.arrayContaining([
          expect.objectContaining({
            imageIndex: 1,
            imageData: mockGeneratedImages[0].imageData,
          }),
        ]),
        expect.any(Object)
      );

      // Should complete successfully with partial images
      expect(mockEventPublishing.publishStatusUpdate).toHaveBeenCalledWith(
        "user-123",
        "episode-456",
        "IMAGE",
        "COMPLETED",
        "episode-456"
      );
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      mockEpisodeAccess.get.mockResolvedValue(mockEpisode);
    });

    it("should handle episode content fetch failure", async () => {
      mockStorageService.getEpisode.mockRejectedValue(
        new Error("S3 fetch failed")
      );

      await expect(handler(mockEvent)).rejects.toThrow("S3 fetch failed");

      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-789",
        1,
        "FAILED",
        expect.objectContaining({
          errorMessage: "S3 fetch failed",
        })
      );

      expect(mockEventPublishing.publishStatusUpdate).toHaveBeenCalledWith(
        "user-123",
        "episode-456",
        "IMAGE",
        "FAILED",
        "episode-456",
        "S3 fetch failed"
      );
    });

    it("should handle complete image generation failure", async () => {
      mockEpisodeAccess.get.mockResolvedValue(mockEpisode);
      mockStorageService.getEpisode.mockResolvedValue("Episode content");
      mockBedrockClient.generateImage.mockRejectedValue(
        new Error("All image generation failed")
      );

      await expect(handler(mockEvent)).rejects.toThrow(
        "No images were successfully generated"
      );

      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-789",
        1,
        "FAILED",
        expect.objectContaining({
          errorMessage: "No images were successfully generated",
        })
      );
    });

    it("should handle PDF creation failure", async () => {
      mockEpisodeAccess.get.mockResolvedValue(mockEpisode);
      mockStorageService.getEpisode.mockResolvedValue("Episode content");
      mockBedrockClient.generateImage.mockResolvedValue({
        imageData: Buffer.from("fake-image"),
        prompt: "test prompt",
      });
      mockStorageService.saveImage.mockResolvedValue({
        bucket: "test-bucket",
        key: "test-key",
      });
      mockPdfGenerator.createEpisodePDF.mockRejectedValue(
        new Error("PDF creation failed")
      );

      await expect(handler(mockEvent)).rejects.toThrow("PDF creation failed");

      expect(mockEpisodeAccess.updateStatus).toHaveBeenCalledWith(
        "story-789",
        1,
        "FAILED",
        expect.objectContaining({
          errorMessage: "PDF creation failed",
        })
      );
    });
  });

  describe("Scene Parsing", () => {
    it("should parse episode content into scenes correctly", async () => {
      const episodeContent = `# Episode 1: Test

First scene content here.

[Scene Break]

Second scene with dialogue.
"Hello there!"

[Scene Break]

Final scene conclusion.`;

      mockEpisodeAccess.get.mockResolvedValue(mockEpisode);
      mockStorageService.getEpisode.mockResolvedValue(episodeContent);
      mockBedrockClient.generateImage.mockResolvedValue({
        imageData: Buffer.from("fake-image"),
        prompt: "test prompt",
      });
      mockStorageService.saveImage.mockResolvedValue({
        bucket: "test-bucket",
        key: "test-key",
      });
      mockPdfGenerator.createEpisodePDF.mockResolvedValue(
        Buffer.from("fake-pdf")
      );
      mockStorageService.saveEpisodePDF.mockResolvedValue({
        bucket: "test-bucket",
        key: "test-pdf-key",
      });

      await handler(mockEvent);

      // Should generate 3 images for 3 scenes
      expect(mockBedrockClient.generateImage).toHaveBeenCalledTimes(3);
    });
  });
});
