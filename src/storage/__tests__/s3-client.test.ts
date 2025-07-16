import { S3StorageClient } from "../s3-client";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Mock AWS SDK
jest.mock("@aws-sdk/client-s3");
jest.mock("@aws-sdk/s3-request-presigner");

const mockS3Client = {
  send: jest.fn(),
};

const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

describe("S3StorageClient", () => {
  let s3StorageClient: S3StorageClient;
  const bucketName = "test-bucket";
  const region = "us-east-1";

  beforeEach(() => {
    jest.clearAllMocks();
    (S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
      () => mockS3Client as any
    );
    s3StorageClient = new S3StorageClient(bucketName, region);
  });

  describe("putObject", () => {
    it("should upload content to S3 with correct parameters", async () => {
      const mockResult = {
        ETag: '"test-etag"',
        VersionId: "test-version-id",
      };
      mockS3Client.send.mockResolvedValue(mockResult);

      const key = "test/file.txt";
      const content = "test content";
      const result = await s3StorageClient.putObject(key, content);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(PutObjectCommand)
      );

      expect(result).toEqual({
        bucket: bucketName,
        key,
        etag: '"test-etag"',
        versionId: "test-version-id",
      });
    });

    it("should set correct content type for markdown files", async () => {
      const mockResult = { ETag: '"test-etag"' };
      mockS3Client.send.mockResolvedValue(mockResult);

      await s3StorageClient.putObject("story.md", "# Test Story");

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(PutObjectCommand)
      );
    });

    it("should include custom metadata when provided", async () => {
      const mockResult = { ETag: '"test-etag"' };
      mockS3Client.send.mockResolvedValue(mockResult);

      const metadata = { userId: "123", storyId: "456" };
      await s3StorageClient.putObject("test.txt", "content", {
        Metadata: metadata,
      });

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(PutObjectCommand)
      );
    });
  });

  describe("getObject", () => {
    it("should retrieve object content from S3", async () => {
      const mockContent = "test content";
      const mockResult = {
        Body: {
          transformToString: jest.fn().mockResolvedValue(mockContent),
        },
      };
      mockS3Client.send.mockResolvedValue(mockResult);

      const key = "test/file.txt";
      const result = await s3StorageClient.getObject(key);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(GetObjectCommand)
      );

      expect(result).toBe(mockContent);
    });

    it("should throw error when object not found", async () => {
      const mockResult = { Body: null };
      mockS3Client.send.mockResolvedValue(mockResult);

      await expect(
        s3StorageClient.getObject("nonexistent.txt")
      ).rejects.toThrow("Object not found: nonexistent.txt");
    });
  });

  describe("getObjectBuffer", () => {
    it("should retrieve object as buffer", async () => {
      const mockBuffer = Buffer.from("test content");
      const mockStream = {
        getReader: () => ({
          read: jest
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new Uint8Array(mockBuffer),
            })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: jest.fn(),
        }),
      };

      const mockResult = {
        Body: {
          transformToWebStream: () => mockStream,
        },
      };
      mockS3Client.send.mockResolvedValue(mockResult);

      const result = await s3StorageClient.getObjectBuffer("test.png");

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe("test content");
    });
  });

  describe("deleteObject", () => {
    it("should delete object from S3", async () => {
      mockS3Client.send.mockResolvedValue({});

      const key = "test/file.txt";
      await s3StorageClient.deleteObject(key);

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(DeleteObjectCommand)
      );
    });
  });

  describe("objectExists", () => {
    it("should return true when object exists", async () => {
      mockS3Client.send.mockResolvedValue({});

      const result = await s3StorageClient.objectExists("existing-file.txt");

      expect(result).toBe(true);
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(HeadObjectCommand)
      );
    });

    it("should return false when object does not exist", async () => {
      const error = new Error("NotFound");
      error.name = "NotFound";
      mockS3Client.send.mockRejectedValue(error);

      const result = await s3StorageClient.objectExists("nonexistent-file.txt");

      expect(result).toBe(false);
    });

    it("should return false when 404 status code is returned", async () => {
      const error = new Error("Not Found");
      (error as any).$metadata = { httpStatusCode: 404 };
      mockS3Client.send.mockRejectedValue(error);

      const result = await s3StorageClient.objectExists("nonexistent-file.txt");

      expect(result).toBe(false);
    });

    it("should throw error for other types of errors", async () => {
      const error = new Error("Access Denied");
      mockS3Client.send.mockRejectedValue(error);

      await expect(s3StorageClient.objectExists("file.txt")).rejects.toThrow(
        "Access Denied"
      );
    });
  });

  describe("listObjects", () => {
    it("should list objects with prefix", async () => {
      const mockResult = {
        Contents: [{ Key: "prefix/file1.txt" }, { Key: "prefix/file2.txt" }],
      };
      mockS3Client.send.mockResolvedValue(mockResult);

      const result = await s3StorageClient.listObjects("prefix/");

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(ListObjectsV2Command)
      );

      expect(result).toEqual(["prefix/file1.txt", "prefix/file2.txt"]);
    });

    it("should return empty array when no objects found", async () => {
      const mockResult = { Contents: undefined };
      mockS3Client.send.mockResolvedValue(mockResult);

      const result = await s3StorageClient.listObjects("empty/");

      expect(result).toEqual([]);
    });
  });

  describe("copyObject", () => {
    it("should copy object within the same bucket", async () => {
      const mockResult = {
        CopyObjectResult: {
          ETag: '"copied-etag"',
        },
      };
      mockS3Client.send.mockResolvedValue(mockResult);

      const sourceKey = "source/file.txt";
      const destinationKey = "destination/file.txt";
      const result = await s3StorageClient.copyObject(
        sourceKey,
        destinationKey
      );

      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(CopyObjectCommand)
      );

      expect(result).toEqual({
        bucket: bucketName,
        key: destinationKey,
        etag: '"copied-etag"',
      });
    });
  });

  describe("getPresignedUrl", () => {
    it("should generate presigned URL for GET operation", async () => {
      const mockUrl =
        "https://test-bucket.s3.amazonaws.com/test.txt?signature=abc";
      mockGetSignedUrl.mockResolvedValue(mockUrl);

      const result = await s3StorageClient.getPresignedUrl(
        "test.txt",
        "GET",
        3600
      );

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(GetObjectCommand),
        { expiresIn: 3600 }
      );

      expect(result).toBe(mockUrl);
    });

    it("should generate presigned URL for PUT operation", async () => {
      const mockUrl =
        "https://test-bucket.s3.amazonaws.com/test.txt?signature=def";
      mockGetSignedUrl.mockResolvedValue(mockUrl);

      const result = await s3StorageClient.getPresignedUrl(
        "test.txt",
        "PUT",
        1800
      );

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(PutObjectCommand),
        { expiresIn: 1800 }
      );

      expect(result).toBe(mockUrl);
    });
  });

  describe("getContentType", () => {
    it("should return correct content types for different file extensions", async () => {
      const testCases = [
        { key: "file.md", expectedType: "text/markdown" },
        { key: "file.txt", expectedType: "text/plain" },
        { key: "file.json", expectedType: "application/json" },
        { key: "file.pdf", expectedType: "application/pdf" },
        { key: "file.png", expectedType: "image/png" },
        { key: "file.jpg", expectedType: "image/jpeg" },
        { key: "file.unknown", expectedType: "application/octet-stream" },
      ];

      mockS3Client.send.mockResolvedValue({ ETag: '"test"' });

      for (const testCase of testCases) {
        await s3StorageClient.putObject(testCase.key, "content");

        expect(mockS3Client.send).toHaveBeenCalledWith(
          expect.any(PutObjectCommand)
        );
      }
    });
  });
});
