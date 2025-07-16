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
import {
  S3FileReference,
  S3PutObjectOptions,
  S3GetObjectOptions,
} from "../types/data-models";

export class S3StorageClient {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(bucketName: string, region: string = "us-east-1") {
    this.s3Client = new S3Client({ region });
    this.bucketName = bucketName;
  }

  /**
   * Upload content to S3
   */
  async putObject(
    key: string,
    content: string | Buffer,
    options?: Partial<S3PutObjectOptions>
  ): Promise<S3FileReference> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: content,
      ContentType: options?.ContentType || this.getContentType(key),
      Metadata: options?.Metadata,
      ServerSideEncryption: "AES256",
      ...options,
    });

    const result = await this.s3Client.send(command);

    return {
      bucket: this.bucketName,
      key,
      etag: result.ETag,
      versionId: result.VersionId,
    };
  }

  /**
   * Get object content from S3
   */
  async getObject(
    key: string,
    options?: Partial<S3GetObjectOptions>
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ...options,
    });

    const result = await this.s3Client.send(command);

    if (!result.Body) {
      throw new Error(`Object not found: ${key}`);
    }

    return await result.Body.transformToString();
  }

  /**
   * Get object as buffer (for binary content like images)
   */
  async getObjectBuffer(
    key: string,
    options?: Partial<S3GetObjectOptions>
  ): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ...options,
    });

    const result = await this.s3Client.send(command);

    if (!result.Body) {
      throw new Error(`Object not found: ${key}`);
    }

    const chunks: Uint8Array[] = [];
    const reader = result.Body.transformToWebStream().getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    return Buffer.from(buffer);
  }

  /**
   * Delete object from S3
   */
  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  /**
   * Check if object exists
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      if (
        error.name === "NotFound" ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * List objects with prefix
   */
  async listObjects(prefix: string, maxKeys: number = 1000): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const result = await this.s3Client.send(command);
    return result.Contents?.map((obj) => obj.Key || "") || [];
  }

  /**
   * Copy object within the same bucket
   */
  async copyObject(
    sourceKey: string,
    destinationKey: string
  ): Promise<S3FileReference> {
    const command = new CopyObjectCommand({
      Bucket: this.bucketName,
      CopySource: `${this.bucketName}/${sourceKey}`,
      Key: destinationKey,
      ServerSideEncryption: "AES256",
    });

    const result = await this.s3Client.send(command);

    return {
      bucket: this.bucketName,
      key: destinationKey,
      etag: result.CopyObjectResult?.ETag,
    };
  }

  /**
   * Generate presigned URL for temporary access
   */
  async getPresignedUrl(
    key: string,
    operation: "GET" | "PUT" = "GET",
    expiresIn: number = 3600
  ): Promise<string> {
    const command =
      operation === "GET"
        ? new GetObjectCommand({ Bucket: this.bucketName, Key: key })
        : new PutObjectCommand({ Bucket: this.bucketName, Key: key });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Get content type based on file extension
   */
  private getContentType(key: string): string {
    const extension = key.split(".").pop()?.toLowerCase();

    const contentTypes: Record<string, string> = {
      md: "text/markdown",
      txt: "text/plain",
      json: "application/json",
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
    };

    return contentTypes[extension || ""] || "application/octet-stream";
  }
}
