import {
  MangaStorageService,
  createMangaStorageService,
} from "../manga-storage";
import { S3StorageClient } from "../s3-client";

// Mock the S3StorageClient
jest.mock("../s3-client");

const mockS3Client = {
  putObject: jest.fn(),
  getObject: jest.fn(),
  getObjectBuffer: jest.fn(),
  deleteObject: jest.fn(),
  objectExists: jest.fn(),
  listObjects: jest.fn(),
  copyObject: jest.fn(),
  getPresignedUrl: jest.fn(),
};

describe("MangaStorageService", () => {
  let mangaStorage: MangaStorageService;
  const bucketName = "test-manga-bucket";
  const userId = "user-123";
  const storyId = "story-456";

  beforeEach(() => {
    jest.clearAllMocks();
    (
      S3StorageClient as jest.MockedClass<typeof S3StorageClient>
    ).mockImplementation(() => mockS3Client as any);
    mangaStorage = new MangaStorageService(bucketName);
  });

  describe("Story Operations", () => {
    describe("saveStory", () => {
      it("should save story with correct key and formatted content", async () => {
        const mockFileRef = {
          bucket: bucketName,
          key: `stories/${userId}/${storyId}/story.md`,
          etag: '"test-etag"',
        };
        mockS3Client.putObject.mockResolvedValue(mockFileRef);

        const story = {
          title: "Test Story",
          content: "This is a test story content.",
          metadata: { genre: "fantasy", rating: "PG" },
        };

        const result = await mangaStorage.saveStory(userId, storyId, story);

        expect(mockS3Client.putObject).toHaveBeenCalledWith(
          `stories/${userId}/${storyId}/story.md`,
          expect.stringContaining("# Test Story"),
          expect.objectContaining({
            ContentType: "text/markdown",
            Metadata: expect.objectContaining({
              userId,
              storyId,
              title: story.title,
              genre: "fantasy",
              rating: "PG",
            }),
          })
        );

        expect(result).toEqual(mockFileRef);
      });

      it("should format story content as markdown with metadata", async () => {
        mockS3Client.putObject.mockResolvedValue({});

        const story = {
          title: "Test Story",
          content: "Story content here.",
          metadata: { author: "AI", genre: "sci-fi" },
        };

        await mangaStorage.saveStory(userId, storyId, story);

        const expectedContent = `---
author: AI
genre: sci-fi
---

# Test Story

Story content here.`;

        expect(mockS3Client.putObject).toHaveBeenCalledWith(
          expect.any(String),
          expectedContent,
          expect.any(Object)
        );
      });
    });

    describe("getStory", () => {
      it("should retrieve story content", async () => {
        const mockContent = "# Test Story\n\nStory content";
        mockS3Client.getObject.mockResolvedValue(mockContent);

        const result = await mangaStorage.getStory(userId, storyId);

        expect(mockS3Client.getObject).toHaveBeenCalledWith(
          `stories/${userId}/${storyId}/story.md`
        );
        expect(result).toBe(mockContent);
      });
    });

    describe("storyExists", () => {
      it("should check if story exists", async () => {
        mockS3Client.objectExists.mockResolvedValue(true);

        const result = await mangaStorage.storyExists(userId, storyId);

        expect(mockS3Client.objectExists).toHaveBeenCalledWith(
          `stories/${userId}/${storyId}/story.md`
        );
        expect(result).toBe(true);
      });
    });
  });

  describe("Episode Operations", () => {
    const episodeNumber = 1;

    describe("saveEpisode", () => {
      it("should save episode with correct key and formatted content", async () => {
        const mockFileRef = {
          bucket: bucketName,
          key: `episodes/${userId}/${storyId}/${episodeNumber}/episode.md`,
          etag: '"episode-etag"',
        };
        mockS3Client.putObject.mockResolvedValue(mockFileRef);

        const episode = {
          episodeNumber,
          title: "The Beginning",
          content: "Episode content here.",
          storyId,
          metadata: { duration: "10min" },
        };

        const result = await mangaStorage.saveEpisode(userId, storyId, episode);

        expect(mockS3Client.putObject).toHaveBeenCalledWith(
          `episodes/${userId}/${storyId}/${episodeNumber}/episode.md`,
          expect.stringContaining("# Episode 1: The Beginning"),
          expect.objectContaining({
            ContentType: "text/markdown",
            Metadata: expect.objectContaining({
              userId,
              storyId,
              episodeNumber: "1",
              title: episode.title,
              duration: "10min",
            }),
          })
        );

        expect(result).toEqual(mockFileRef);
      });
    });

    describe("getEpisode", () => {
      it("should retrieve episode content", async () => {
        const mockContent = "# Episode 1: The Beginning\n\nEpisode content";
        mockS3Client.getObject.mockResolvedValue(mockContent);

        const result = await mangaStorage.getEpisode(
          userId,
          storyId,
          episodeNumber
        );

        expect(mockS3Client.getObject).toHaveBeenCalledWith(
          `episodes/${userId}/${storyId}/${episodeNumber}/episode.md`
        );
        expect(result).toBe(mockContent);
      });
    });

    describe("saveEpisodePDF", () => {
      it("should save episode PDF with correct key", async () => {
        const mockFileRef = {
          bucket: bucketName,
          key: `episodes/${userId}/${storyId}/${episodeNumber}/episode.pdf`,
          etag: '"pdf-etag"',
        };
        mockS3Client.putObject.mockResolvedValue(mockFileRef);

        const pdfBuffer = Buffer.from("PDF content");
        const result = await mangaStorage.saveEpisodePDF(
          userId,
          storyId,
          episodeNumber,
          pdfBuffer
        );

        expect(mockS3Client.putObject).toHaveBeenCalledWith(
          `episodes/${userId}/${storyId}/${episodeNumber}/episode.pdf`,
          pdfBuffer,
          expect.objectContaining({
            ContentType: "application/pdf",
            Metadata: expect.objectContaining({
              userId,
              storyId,
              episodeNumber: "1",
            }),
          })
        );

        expect(result).toEqual(mockFileRef);
      });
    });

    describe("getEpisodePDF", () => {
      it("should retrieve episode PDF as buffer", async () => {
        const mockBuffer = Buffer.from("PDF content");
        mockS3Client.getObjectBuffer.mockResolvedValue(mockBuffer);

        const result = await mangaStorage.getEpisodePDF(
          userId,
          storyId,
          episodeNumber
        );

        expect(mockS3Client.getObjectBuffer).toHaveBeenCalledWith(
          `episodes/${userId}/${storyId}/${episodeNumber}/episode.pdf`
        );
        expect(result).toEqual(mockBuffer);
      });
    });
  });

  describe("Image Operations", () => {
    const episodeNumber = 1;
    const imageIndex = 0;

    describe("saveImage", () => {
      it("should save image with correct key and metadata", async () => {
        const mockFileRef = {
          bucket: bucketName,
          key: `images/${userId}/${storyId}/${episodeNumber}/generated/000-test-image.png`,
          etag: '"image-etag"',
        };
        mockS3Client.putObject.mockResolvedValue(mockFileRef);

        const image = {
          imageData: Buffer.from("image data"),
          filename: "test-image.png",
          contentType: "image/png",
        };

        const result = await mangaStorage.saveImage(
          userId,
          storyId,
          episodeNumber,
          imageIndex,
          image
        );

        expect(mockS3Client.putObject).toHaveBeenCalledWith(
          `images/${userId}/${storyId}/${episodeNumber}/generated/000-test-image.png`,
          image.imageData,
          expect.objectContaining({
            ContentType: "image/png",
            Metadata: expect.objectContaining({
              userId,
              storyId,
              episodeNumber: "1",
              imageIndex: "0",
              filename: "test-image.png",
            }),
          })
        );

        expect(result).toEqual(mockFileRef);
      });

      it("should pad image index correctly", async () => {
        mockS3Client.putObject.mockResolvedValue({});

        const image = {
          imageData: Buffer.from("image data"),
          filename: "test.png",
          contentType: "image/png",
        };

        await mangaStorage.saveImage(userId, storyId, episodeNumber, 15, image);

        expect(mockS3Client.putObject).toHaveBeenCalledWith(
          `images/${userId}/${storyId}/${episodeNumber}/generated/015-test.png`,
          expect.any(Buffer),
          expect.any(Object)
        );
      });
    });

    describe("getImage", () => {
      it("should retrieve image as buffer", async () => {
        const mockBuffer = Buffer.from("image data");
        mockS3Client.getObjectBuffer.mockResolvedValue(mockBuffer);

        const filename = "test-image.png";
        const result = await mangaStorage.getImage(
          userId,
          storyId,
          episodeNumber,
          imageIndex,
          filename
        );

        expect(mockS3Client.getObjectBuffer).toHaveBeenCalledWith(
          `images/${userId}/${storyId}/${episodeNumber}/generated/000-${filename}`
        );
        expect(result).toEqual(mockBuffer);
      });
    });

    describe("listEpisodeImages", () => {
      it("should list all images for an episode", async () => {
        const mockImages = [
          `images/${userId}/${storyId}/${episodeNumber}/generated/000-image1.png`,
          `images/${userId}/${storyId}/${episodeNumber}/generated/001-image2.png`,
        ];
        mockS3Client.listObjects.mockResolvedValue(mockImages);

        const result = await mangaStorage.listEpisodeImages(
          userId,
          storyId,
          episodeNumber
        );

        expect(mockS3Client.listObjects).toHaveBeenCalledWith(
          `images/${userId}/${storyId}/${episodeNumber}/generated/`
        );
        expect(result).toEqual(mockImages);
      });
    });
  });

  describe("Utility Operations", () => {
    describe("getPresignedUrl", () => {
      it("should generate presigned URL for story", async () => {
        const mockUrl = "https://presigned-url.com";
        mockS3Client.getPresignedUrl.mockResolvedValue(mockUrl);

        const result = await mangaStorage.getPresignedUrl(
          userId,
          storyId,
          "story"
        );

        expect(mockS3Client.getPresignedUrl).toHaveBeenCalledWith(
          `stories/${userId}/${storyId}/story.md`,
          "GET",
          3600
        );
        expect(result).toBe(mockUrl);
      });

      it("should generate presigned URL for episode", async () => {
        const mockUrl = "https://presigned-url.com";
        mockS3Client.getPresignedUrl.mockResolvedValue(mockUrl);

        const result = await mangaStorage.getPresignedUrl(
          userId,
          storyId,
          "episode",
          1
        );

        expect(mockS3Client.getPresignedUrl).toHaveBeenCalledWith(
          `episodes/${userId}/${storyId}/1/episode.md`,
          "GET",
          3600
        );
        expect(result).toBe(mockUrl);
      });

      it("should generate presigned URL for PDF", async () => {
        const mockUrl = "https://presigned-url.com";
        mockS3Client.getPresignedUrl.mockResolvedValue(mockUrl);

        const result = await mangaStorage.getPresignedUrl(
          userId,
          storyId,
          "pdf",
          1,
          1800
        );

        expect(mockS3Client.getPresignedUrl).toHaveBeenCalledWith(
          `episodes/${userId}/${storyId}/1/episode.pdf`,
          "GET",
          1800
        );
        expect(result).toBe(mockUrl);
      });

      it("should throw error for episode type without episode number", async () => {
        await expect(
          mangaStorage.getPresignedUrl(userId, storyId, "episode")
        ).rejects.toThrow("Episode number required for episode type");
      });

      it("should throw error for unsupported content type", async () => {
        await expect(
          mangaStorage.getPresignedUrl(userId, storyId, "invalid" as any)
        ).rejects.toThrow("Unsupported content type: invalid");
      });
    });

    describe("deleteStory", () => {
      it("should delete all story-related content", async () => {
        const storyObjects = [`stories/${userId}/${storyId}/story.md`];
        const episodeObjects = [
          `episodes/${userId}/${storyId}/1/episode.md`,
          `episodes/${userId}/${storyId}/1/episode.pdf`,
        ];
        const imageObjects = [
          `images/${userId}/${storyId}/1/generated/000-image1.png`,
          `images/${userId}/${storyId}/1/generated/001-image2.png`,
        ];

        mockS3Client.listObjects
          .mockResolvedValueOnce(storyObjects)
          .mockResolvedValueOnce(episodeObjects)
          .mockResolvedValueOnce(imageObjects);

        mockS3Client.deleteObject.mockResolvedValue(undefined);

        await mangaStorage.deleteStory(userId, storyId);

        expect(mockS3Client.listObjects).toHaveBeenCalledTimes(3);
        expect(mockS3Client.listObjects).toHaveBeenCalledWith(
          `stories/${userId}/${storyId}/`
        );
        expect(mockS3Client.listObjects).toHaveBeenCalledWith(
          `episodes/${userId}/${storyId}/`
        );
        expect(mockS3Client.listObjects).toHaveBeenCalledWith(
          `images/${userId}/${storyId}/`
        );

        const allObjects = [
          ...storyObjects,
          ...episodeObjects,
          ...imageObjects,
        ];
        expect(mockS3Client.deleteObject).toHaveBeenCalledTimes(
          allObjects.length
        );

        allObjects.forEach((key) => {
          expect(mockS3Client.deleteObject).toHaveBeenCalledWith(key);
        });
      });
    });
  });
});

describe("createMangaStorageService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should create MangaStorageService with environment variables", () => {
    process.env.S3_BUCKET_NAME = "test-bucket";
    process.env.AWS_REGION = "us-west-2";

    const service = createMangaStorageService();

    expect(service).toBeInstanceOf(MangaStorageService);
    expect(S3StorageClient).toHaveBeenCalledWith("test-bucket", "us-west-2");
  });

  it("should use default region when AWS_REGION is not set", () => {
    process.env.S3_BUCKET_NAME = "test-bucket";
    delete process.env.AWS_REGION;

    const service = createMangaStorageService();

    expect(service).toBeInstanceOf(MangaStorageService);
    expect(S3StorageClient).toHaveBeenCalledWith("test-bucket", "us-east-1");
  });

  it("should throw error when S3_BUCKET_NAME is not set", () => {
    delete process.env.S3_BUCKET_NAME;

    expect(() => createMangaStorageService()).toThrow(
      "S3_BUCKET_NAME environment variable is required"
    );
  });
});
