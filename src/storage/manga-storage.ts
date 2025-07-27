import { S3StorageClient } from "./s3-client";
import { S3FileReference } from "../types/data-models";

export interface StoryContent {
  title: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface EpisodeContent {
  episodeNumber: number;
  title: string;
  content: string;
  storyId: string;
  metadata?: Record<string, any>;
}

export interface ImageContent {
  imageData: Buffer;
  filename: string;
  contentType: string;
}

export class MangaStorageService {
  private s3Client: S3StorageClient;

  constructor(bucketName: string, region?: string) {
    this.s3Client = new S3StorageClient(bucketName, region);
  }

  /**
   * Story Storage Operations
   */

  /**
   * Save story content as Markdown file
   */
  async saveStory(
    userId: string,
    storyId: string,
    story: StoryContent
  ): Promise<S3FileReference> {
    const key = this.getStoryKey(userId, storyId);
    const content = this.formatStoryMarkdown(story);

    // Ensure all metadata values are strings and valid HTTP header values (S3 requirement)
    const sanitizedMetadata = story.metadata
      ? Object.fromEntries(
          Object.entries(story.metadata).map(([key, value]) => [
            key,
            this.sanitizeHeaderValue(
              typeof value === "string" ? value : String(value)
            ),
          ])
        )
      : {};

    return await this.s3Client.putObject(key, content, {
      ContentType: "text/markdown",
      Metadata: {
        userId,
        storyId,
        title: story.title,
        createdAt: new Date().toISOString(),
        ...sanitizedMetadata,
      },
    });
  }

  /**
   * Get story content
   */
  async getStory(userId: string, storyId: string): Promise<string> {
    const key = this.getStoryKey(userId, storyId);
    return await this.s3Client.getObject(key);
  }

  /**
   * Check if story exists
   */
  async storyExists(userId: string, storyId: string): Promise<boolean> {
    const key = this.getStoryKey(userId, storyId);
    return await this.s3Client.objectExists(key);
  }

  /**
   * Episode Storage Operations
   */

  /**
   * Save episode content as Markdown file
   */
  async saveEpisode(
    userId: string,
    storyId: string,
    episode: EpisodeContent
  ): Promise<S3FileReference> {
    const key = this.getEpisodeKey(userId, storyId, episode.episodeNumber);
    const content = this.formatEpisodeMarkdown(episode);

    // Ensure all metadata values are strings and valid HTTP header values (S3 requirement)
    const sanitizedMetadata = episode.metadata
      ? Object.fromEntries(
          Object.entries(episode.metadata).map(([key, value]) => [
            key,
            this.sanitizeHeaderValue(
              typeof value === "string" ? value : String(value)
            ),
          ])
        )
      : {};

    return await this.s3Client.putObject(key, content, {
      ContentType: "text/markdown",
      Metadata: {
        userId,
        storyId,
        episodeNumber: episode.episodeNumber.toString(),
        title: episode.title,
        createdAt: new Date().toISOString(),
        ...sanitizedMetadata,
      },
    });
  }

  /**
   * Get episode content
   */
  async getEpisode(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): Promise<string> {
    const key = this.getEpisodeKey(userId, storyId, episodeNumber);
    return await this.s3Client.getObject(key);
  }

  /**
   * Save episode PDF
   */
  async saveEpisodePDF(
    userId: string,
    storyId: string,
    episodeNumber: number,
    pdfBuffer: Buffer
  ): Promise<S3FileReference> {
    const key = this.getEpisodePDFKey(userId, storyId, episodeNumber);

    return await this.s3Client.putObject(key, pdfBuffer, {
      ContentType: "application/pdf",
      Metadata: {
        userId,
        storyId,
        episodeNumber: episodeNumber.toString(),
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Get episode PDF
   */
  async getEpisodePDF(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): Promise<Buffer> {
    const key = this.getEpisodePDFKey(userId, storyId, episodeNumber);
    return await this.s3Client.getObjectBuffer(key);
  }

  /**
   * Image Storage Operations
   */

  /**
   * Save generated image
   */
  async saveImage(
    userId: string,
    storyId: string,
    episodeNumber: number,
    imageIndex: number,
    image: ImageContent
  ): Promise<S3FileReference> {
    const key = this.getImageKey(
      userId,
      storyId,
      episodeNumber,
      imageIndex,
      image.filename
    );

    return await this.s3Client.putObject(key, image.imageData, {
      ContentType: image.contentType,
      Metadata: {
        userId,
        storyId,
        episodeNumber: episodeNumber.toString(),
        imageIndex: imageIndex.toString(),
        filename: image.filename,
        createdAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Get image
   */
  async getImage(
    userId: string,
    storyId: string,
    episodeNumber: number,
    imageIndex: number,
    filename: string
  ): Promise<Buffer> {
    const key = this.getImageKey(
      userId,
      storyId,
      episodeNumber,
      imageIndex,
      filename
    );
    return await this.s3Client.getObjectBuffer(key);
  }

  /**
   * List all images for an episode
   */
  async listEpisodeImages(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): Promise<string[]> {
    const prefix = this.getImagePrefix(userId, storyId, episodeNumber);
    return await this.s3Client.listObjects(prefix);
  }

  /**
   * Utility Operations
   */

  /**
   * Generate presigned URL for content access
   */
  async getPresignedUrl(
    userId: string,
    storyId: string,
    type: "story" | "episode" | "pdf",
    episodeNumber?: number,
    expiresIn: number = 3600
  ): Promise<string> {
    let key: string;

    switch (type) {
      case "story":
        key = this.getStoryKey(userId, storyId);
        break;
      case "episode":
        if (episodeNumber === undefined) {
          throw new Error("Episode number required for episode type");
        }
        key = this.getEpisodeKey(userId, storyId, episodeNumber);
        break;
      case "pdf":
        if (episodeNumber === undefined) {
          throw new Error("Episode number required for PDF type");
        }
        key = this.getEpisodePDFKey(userId, storyId, episodeNumber);
        break;
      default:
        throw new Error(`Unsupported content type: ${type}`);
    }

    return await this.s3Client.getPresignedUrl(key, "GET", expiresIn);
  }

  /**
   * Delete story and all related content
   */
  async deleteStory(userId: string, storyId: string): Promise<void> {
    const storyPrefix = `stories/${userId}/${storyId}/`;
    const episodePrefix = `episodes/${userId}/${storyId}/`;
    const imagePrefix = `images/${userId}/${storyId}/`;

    // List and delete all objects with these prefixes
    const [storyObjects, episodeObjects, imageObjects] = await Promise.all([
      this.s3Client.listObjects(storyPrefix),
      this.s3Client.listObjects(episodePrefix),
      this.s3Client.listObjects(imagePrefix),
    ]);

    const allObjects = [...storyObjects, ...episodeObjects, ...imageObjects];

    // Delete all objects
    await Promise.all(allObjects.map((key) => this.s3Client.deleteObject(key)));
  }

  /**
   * Private helper methods for key generation
   */

  private getStoryKey(userId: string, storyId: string): string {
    return `stories/${userId}/${storyId}/story.md`;
  }

  private getEpisodeKey(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): string {
    return `episodes/${userId}/${storyId}/${episodeNumber}/episode.md`;
  }

  private getEpisodePDFKey(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): string {
    return `episodes/${userId}/${storyId}/${episodeNumber}/episode.pdf`;
  }

  private getImageKey(
    userId: string,
    storyId: string,
    episodeNumber: number,
    imageIndex: number,
    filename: string
  ): string {
    const paddedIndex = imageIndex.toString().padStart(3, "0");
    return `images/${userId}/${storyId}/${episodeNumber}/generated/${paddedIndex}-${filename}`;
  }

  private getImagePrefix(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): string {
    return `images/${userId}/${storyId}/${episodeNumber}/generated/`;
  }

  /**
   * Format story content as Markdown
   */
  private formatStoryMarkdown(story: StoryContent): string {
    const metadata = story.metadata
      ? `---\n${Object.entries(story.metadata)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")}\n---\n\n`
      : "";

    return `${metadata}# ${story.title}\n\n${story.content}`;
  }

  /**
   * Format episode content as Markdown
   */
  private formatEpisodeMarkdown(episode: EpisodeContent): string {
    const metadata = episode.metadata
      ? `---\n${Object.entries(episode.metadata)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")}\n---\n\n`
      : "";

    return `${metadata}# Episode ${episode.episodeNumber}: ${episode.title}\n\n${episode.content}`;
  }

  /**
   * Sanitize metadata values to be valid HTTP header values
   * S3 metadata becomes HTTP headers, so they must follow HTTP header rules
   */
  private sanitizeHeaderValue(value: string): string {
    // Remove or replace characters that are not allowed in HTTP headers
    // HTTP headers must be ASCII and cannot contain control characters
    return value
      .replace(/[\x00-\x1F\x7F-\xFF]/g, "") // Remove control characters and non-ASCII
      .replace(/[<>"'&]/g, "") // Remove HTML-problematic characters
      .replace(/\r?\n/g, " ") // Replace newlines with spaces
      .replace(/\s+/g, " ") // Collapse multiple spaces
      .trim()
      .substring(0, 2048); // Limit length (S3 metadata has size limits)
  }
}

// Factory function to create MangaStorageService with environment configuration
export function createMangaStorageService(): MangaStorageService {
  const bucketName = process.env.S3_BUCKET_NAME;
  const region = process.env.AWS_REGION || "us-east-1";

  if (!bucketName) {
    throw new Error("S3_BUCKET_NAME environment variable is required");
  }

  return new MangaStorageService(bucketName, region);
}
