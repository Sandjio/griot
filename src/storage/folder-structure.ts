/**
 * S3 Folder Structure Utilities for Manga Platform
 *
 * This module provides utilities to validate and manage the S3 folder structure
 * according to the design specification:
 *
 * /stories/
 *   /{userId}/
 *     /{storyId}/
 *       story.md
 * /episodes/
 *   /{userId}/
 *     /{storyId}/
 *       /{episodeNumber}/
 *         episode.md
 *         episode.pdf
 * /images/
 *   /{userId}/
 *     /{storyId}/
 *       /{episodeNumber}/
 *         /generated/
 *           image-001.png
 *           image-002.png
 */

export interface S3FolderStructure {
  stories: string;
  episodes: string;
  images: string;
}

export interface S3PathComponents {
  userId: string;
  storyId: string;
  episodeNumber?: number;
  filename?: string;
}

export class S3FolderManager {
  private static readonly FOLDER_STRUCTURE: S3FolderStructure = {
    stories: "stories",
    episodes: "episodes",
    images: "images",
  };

  /**
   * Generate story file path
   */
  static getStoryPath(userId: string, storyId: string): string {
    this.validateUserId(userId);
    this.validateStoryId(storyId);

    return `${this.FOLDER_STRUCTURE.stories}/${userId}/${storyId}/story.md`;
  }

  /**
   * Generate episode file path
   */
  static getEpisodePath(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): string {
    this.validateUserId(userId);
    this.validateStoryId(storyId);
    this.validateEpisodeNumber(episodeNumber);

    return `${this.FOLDER_STRUCTURE.episodes}/${userId}/${storyId}/${episodeNumber}/episode.md`;
  }

  /**
   * Generate episode PDF path
   */
  static getEpisodePDFPath(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): string {
    this.validateUserId(userId);
    this.validateStoryId(storyId);
    this.validateEpisodeNumber(episodeNumber);

    return `${this.FOLDER_STRUCTURE.episodes}/${userId}/${storyId}/${episodeNumber}/episode.pdf`;
  }

  /**
   * Generate image file path
   */
  static getImagePath(
    userId: string,
    storyId: string,
    episodeNumber: number,
    imageIndex: number,
    filename: string
  ): string {
    this.validateUserId(userId);
    this.validateStoryId(storyId);
    this.validateEpisodeNumber(episodeNumber);
    this.validateImageIndex(imageIndex);
    this.validateFilename(filename);

    const paddedIndex = imageIndex.toString().padStart(3, "0");
    return `${this.FOLDER_STRUCTURE.images}/${userId}/${storyId}/${episodeNumber}/generated/${paddedIndex}-${filename}`;
  }

  /**
   * Generate folder prefix for listing operations
   */
  static getStoryFolderPrefix(userId: string, storyId: string): string {
    this.validateUserId(userId);
    this.validateStoryId(storyId);

    return `${this.FOLDER_STRUCTURE.stories}/${userId}/${storyId}/`;
  }

  static getEpisodeFolderPrefix(userId: string, storyId: string): string {
    this.validateUserId(userId);
    this.validateStoryId(storyId);

    return `${this.FOLDER_STRUCTURE.episodes}/${userId}/${storyId}/`;
  }

  static getImageFolderPrefix(
    userId: string,
    storyId: string,
    episodeNumber: number
  ): string {
    this.validateUserId(userId);
    this.validateStoryId(storyId);
    this.validateEpisodeNumber(episodeNumber);

    return `${this.FOLDER_STRUCTURE.images}/${userId}/${storyId}/${episodeNumber}/generated/`;
  }

  static getUserContentPrefix(userId: string): string {
    this.validateUserId(userId);

    return `${userId}/`;
  }

  /**
   * Parse S3 path to extract components
   */
  static parseS3Path(s3Key: string): S3PathComponents | null {
    const pathParts = s3Key.split("/");

    if (pathParts.length < 3) {
      return null;
    }

    const [folderType, userId, storyId, ...rest] = pathParts;

    if (!this.isValidFolderType(folderType) || !userId || !storyId) {
      return null;
    }

    const components: S3PathComponents = {
      userId,
      storyId,
    };

    // Parse episode number and filename based on folder type
    if (folderType === this.FOLDER_STRUCTURE.episodes && rest.length >= 1) {
      const episodeNumber = parseInt(rest[0], 10);
      if (!isNaN(episodeNumber)) {
        components.episodeNumber = episodeNumber;
      }
      if (rest.length >= 2) {
        components.filename = rest[rest.length - 1];
      }
    } else if (
      folderType === this.FOLDER_STRUCTURE.images &&
      rest.length >= 3
    ) {
      const episodeNumber = parseInt(rest[0], 10);
      if (!isNaN(episodeNumber)) {
        components.episodeNumber = episodeNumber;
      }
      if (rest[1] === "generated" && rest.length >= 3) {
        components.filename = rest[2];
      }
    } else if (
      folderType === this.FOLDER_STRUCTURE.stories &&
      rest.length >= 1
    ) {
      components.filename = rest[0];
    }

    return components;
  }

  /**
   * Validate S3 path structure
   */
  static validateS3Path(s3Key: string): boolean {
    const components = this.parseS3Path(s3Key);
    return components !== null;
  }

  /**
   * Get content type based on file extension
   */
  static getContentTypeFromPath(s3Key: string): string {
    const extension = s3Key.split(".").pop()?.toLowerCase();

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
      webp: "image/webp",
    };

    return contentTypes[extension || ""] || "application/octet-stream";
  }

  /**
   * Generate all related paths for cleanup operations
   */
  static getAllRelatedPaths(userId: string, storyId: string): string[] {
    this.validateUserId(userId);
    this.validateStoryId(storyId);

    return [
      this.getStoryFolderPrefix(userId, storyId),
      this.getEpisodeFolderPrefix(userId, storyId),
      `${this.FOLDER_STRUCTURE.images}/${userId}/${storyId}/`,
    ];
  }

  /**
   * Validation methods
   */
  private static validateUserId(userId: string): void {
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("Invalid userId: must be a non-empty string");
    }

    if (userId.includes("/") || userId.includes("\\")) {
      throw new Error("Invalid userId: cannot contain path separators");
    }

    if (userId.length > 100) {
      throw new Error("Invalid userId: maximum length is 100 characters");
    }
  }

  private static validateStoryId(storyId: string): void {
    if (
      !storyId ||
      typeof storyId !== "string" ||
      storyId.trim().length === 0
    ) {
      throw new Error("Invalid storyId: must be a non-empty string");
    }

    if (storyId.includes("/") || storyId.includes("\\")) {
      throw new Error("Invalid storyId: cannot contain path separators");
    }

    if (storyId.length > 100) {
      throw new Error("Invalid storyId: maximum length is 100 characters");
    }
  }

  private static validateEpisodeNumber(episodeNumber: number): void {
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) {
      throw new Error("Invalid episodeNumber: must be a positive integer");
    }

    if (episodeNumber > 9999) {
      throw new Error("Invalid episodeNumber: maximum value is 9999");
    }
  }

  private static validateImageIndex(imageIndex: number): void {
    if (!Number.isInteger(imageIndex) || imageIndex < 0) {
      throw new Error("Invalid imageIndex: must be a non-negative integer");
    }

    if (imageIndex > 999) {
      throw new Error("Invalid imageIndex: maximum value is 999");
    }
  }

  private static validateFilename(filename: string): void {
    if (
      !filename ||
      typeof filename !== "string" ||
      filename.trim().length === 0
    ) {
      throw new Error("Invalid filename: must be a non-empty string");
    }

    if (filename.includes("/") || filename.includes("\\")) {
      throw new Error("Invalid filename: cannot contain path separators");
    }

    if (filename.length > 255) {
      throw new Error("Invalid filename: maximum length is 255 characters");
    }

    // Check for valid file extension
    const extension = filename.split(".").pop()?.toLowerCase();
    const validExtensions = [
      "md",
      "txt",
      "json",
      "pdf",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "svg",
      "webp",
    ];

    if (!extension || !validExtensions.includes(extension)) {
      throw new Error(
        `Invalid filename: unsupported file extension. Supported: ${validExtensions.join(
          ", "
        )}`
      );
    }
  }

  private static isValidFolderType(folderType: string): boolean {
    return Object.values(this.FOLDER_STRUCTURE).includes(folderType);
  }
}

// Export folder structure constants for external use
export const MANGA_FOLDER_STRUCTURE = S3FolderManager["FOLDER_STRUCTURE"];
