import { S3FolderManager, MANGA_FOLDER_STRUCTURE } from "../folder-structure";

describe("S3FolderManager", () => {
  const userId = "user-123";
  const storyId = "story-456";
  const episodeNumber = 1;
  const imageIndex = 0;
  const filename = "test.png";

  describe("Path Generation", () => {
    describe("getStoryPath", () => {
      it("should generate correct story path", () => {
        const result = S3FolderManager.getStoryPath(userId, storyId);
        expect(result).toBe("stories/user-123/story-456/story.md");
      });

      it("should throw error for invalid userId", () => {
        expect(() => S3FolderManager.getStoryPath("", storyId)).toThrow(
          "Invalid userId: must be a non-empty string"
        );
      });

      it("should throw error for invalid storyId", () => {
        expect(() => S3FolderManager.getStoryPath(userId, "")).toThrow(
          "Invalid storyId: must be a non-empty string"
        );
      });
    });

    describe("getEpisodePath", () => {
      it("should generate correct episode path", () => {
        const result = S3FolderManager.getEpisodePath(
          userId,
          storyId,
          episodeNumber
        );
        expect(result).toBe("episodes/user-123/story-456/1/episode.md");
      });

      it("should throw error for invalid episode number", () => {
        expect(() =>
          S3FolderManager.getEpisodePath(userId, storyId, 0)
        ).toThrow("Invalid episodeNumber: must be a positive integer");
      });
    });

    describe("getEpisodePDFPath", () => {
      it("should generate correct episode PDF path", () => {
        const result = S3FolderManager.getEpisodePDFPath(
          userId,
          storyId,
          episodeNumber
        );
        expect(result).toBe("episodes/user-123/story-456/1/episode.pdf");
      });
    });

    describe("getImagePath", () => {
      it("should generate correct image path with padded index", () => {
        const result = S3FolderManager.getImagePath(
          userId,
          storyId,
          episodeNumber,
          imageIndex,
          filename
        );
        expect(result).toBe(
          "images/user-123/story-456/1/generated/000-test.png"
        );
      });

      it("should pad image index correctly for larger numbers", () => {
        const result = S3FolderManager.getImagePath(
          userId,
          storyId,
          episodeNumber,
          15,
          filename
        );
        expect(result).toBe(
          "images/user-123/story-456/1/generated/015-test.png"
        );
      });

      it("should throw error for invalid image index", () => {
        expect(() =>
          S3FolderManager.getImagePath(
            userId,
            storyId,
            episodeNumber,
            -1,
            filename
          )
        ).toThrow("Invalid imageIndex: must be a non-negative integer");
      });

      it("should throw error for invalid filename", () => {
        expect(() =>
          S3FolderManager.getImagePath(
            userId,
            storyId,
            episodeNumber,
            imageIndex,
            ""
          )
        ).toThrow("Invalid filename: must be a non-empty string");
      });
    });
  });

  describe("Folder Prefix Generation", () => {
    describe("getStoryFolderPrefix", () => {
      it("should generate correct story folder prefix", () => {
        const result = S3FolderManager.getStoryFolderPrefix(userId, storyId);
        expect(result).toBe("stories/user-123/story-456/");
      });
    });

    describe("getEpisodeFolderPrefix", () => {
      it("should generate correct episode folder prefix", () => {
        const result = S3FolderManager.getEpisodeFolderPrefix(userId, storyId);
        expect(result).toBe("episodes/user-123/story-456/");
      });
    });

    describe("getImageFolderPrefix", () => {
      it("should generate correct image folder prefix", () => {
        const result = S3FolderManager.getImageFolderPrefix(
          userId,
          storyId,
          episodeNumber
        );
        expect(result).toBe("images/user-123/story-456/1/generated/");
      });
    });

    describe("getUserContentPrefix", () => {
      it("should generate correct user content prefix", () => {
        const result = S3FolderManager.getUserContentPrefix(userId);
        expect(result).toBe("user-123/");
      });
    });
  });

  describe("Path Parsing", () => {
    describe("parseS3Path", () => {
      it("should parse story path correctly", () => {
        const path = "stories/user-123/story-456/story.md";
        const result = S3FolderManager.parseS3Path(path);

        expect(result).toEqual({
          userId: "user-123",
          storyId: "story-456",
          filename: "story.md",
        });
      });

      it("should parse episode path correctly", () => {
        const path = "episodes/user-123/story-456/1/episode.md";
        const result = S3FolderManager.parseS3Path(path);

        expect(result).toEqual({
          userId: "user-123",
          storyId: "story-456",
          episodeNumber: 1,
          filename: "episode.md",
        });
      });

      it("should parse image path correctly", () => {
        const path = "images/user-123/story-456/1/generated/000-test.png";
        const result = S3FolderManager.parseS3Path(path);

        expect(result).toEqual({
          userId: "user-123",
          storyId: "story-456",
          episodeNumber: 1,
          filename: "000-test.png",
        });
      });

      it("should return null for invalid path", () => {
        const path = "invalid/path";
        const result = S3FolderManager.parseS3Path(path);

        expect(result).toBeNull();
      });

      it("should return null for empty path", () => {
        const result = S3FolderManager.parseS3Path("");
        expect(result).toBeNull();
      });
    });

    describe("validateS3Path", () => {
      it("should validate correct story path", () => {
        const path = "stories/user-123/story-456/story.md";
        const result = S3FolderManager.validateS3Path(path);
        expect(result).toBe(true);
      });

      it("should validate correct episode path", () => {
        const path = "episodes/user-123/story-456/1/episode.md";
        const result = S3FolderManager.validateS3Path(path);
        expect(result).toBe(true);
      });

      it("should validate correct image path", () => {
        const path = "images/user-123/story-456/1/generated/000-test.png";
        const result = S3FolderManager.validateS3Path(path);
        expect(result).toBe(true);
      });

      it("should reject invalid path", () => {
        const path = "invalid/path";
        const result = S3FolderManager.validateS3Path(path);
        expect(result).toBe(false);
      });
    });
  });

  describe("Content Type Detection", () => {
    describe("getContentTypeFromPath", () => {
      it("should return correct content types", () => {
        const testCases = [
          { path: "story.md", expected: "text/markdown" },
          { path: "file.txt", expected: "text/plain" },
          { path: "data.json", expected: "application/json" },
          { path: "document.pdf", expected: "application/pdf" },
          { path: "image.png", expected: "image/png" },
          { path: "photo.jpg", expected: "image/jpeg" },
          { path: "photo.jpeg", expected: "image/jpeg" },
          { path: "animation.gif", expected: "image/gif" },
          { path: "vector.svg", expected: "image/svg+xml" },
          { path: "modern.webp", expected: "image/webp" },
          { path: "unknown.xyz", expected: "application/octet-stream" },
        ];

        testCases.forEach(({ path, expected }) => {
          const result = S3FolderManager.getContentTypeFromPath(path);
          expect(result).toBe(expected);
        });
      });
    });
  });

  describe("Cleanup Operations", () => {
    describe("getAllRelatedPaths", () => {
      it("should return all related paths for cleanup", () => {
        const result = S3FolderManager.getAllRelatedPaths(userId, storyId);

        expect(result).toEqual([
          "stories/user-123/story-456/",
          "episodes/user-123/story-456/",
          "images/user-123/story-456/",
        ]);
      });
    });
  });

  describe("Validation", () => {
    describe("userId validation", () => {
      it("should reject empty userId", () => {
        expect(() => S3FolderManager.getStoryPath("", storyId)).toThrow(
          "Invalid userId: must be a non-empty string"
        );
      });

      it("should reject userId with path separators", () => {
        expect(() => S3FolderManager.getStoryPath("user/123", storyId)).toThrow(
          "Invalid userId: cannot contain path separators"
        );

        expect(() =>
          S3FolderManager.getStoryPath("user\\123", storyId)
        ).toThrow("Invalid userId: cannot contain path separators");
      });

      it("should reject userId that is too long", () => {
        const longUserId = "a".repeat(101);
        expect(() => S3FolderManager.getStoryPath(longUserId, storyId)).toThrow(
          "Invalid userId: maximum length is 100 characters"
        );
      });
    });

    describe("storyId validation", () => {
      it("should reject empty storyId", () => {
        expect(() => S3FolderManager.getStoryPath(userId, "")).toThrow(
          "Invalid storyId: must be a non-empty string"
        );
      });

      it("should reject storyId with path separators", () => {
        expect(() => S3FolderManager.getStoryPath(userId, "story/123")).toThrow(
          "Invalid storyId: cannot contain path separators"
        );
      });

      it("should reject storyId that is too long", () => {
        const longStoryId = "a".repeat(101);
        expect(() => S3FolderManager.getStoryPath(userId, longStoryId)).toThrow(
          "Invalid storyId: maximum length is 100 characters"
        );
      });
    });

    describe("episodeNumber validation", () => {
      it("should reject non-integer episode numbers", () => {
        expect(() =>
          S3FolderManager.getEpisodePath(userId, storyId, 1.5)
        ).toThrow("Invalid episodeNumber: must be a positive integer");
      });

      it("should reject episode numbers that are too large", () => {
        expect(() =>
          S3FolderManager.getEpisodePath(userId, storyId, 10000)
        ).toThrow("Invalid episodeNumber: maximum value is 9999");
      });
    });

    describe("imageIndex validation", () => {
      it("should reject negative image index", () => {
        expect(() =>
          S3FolderManager.getImagePath(
            userId,
            storyId,
            episodeNumber,
            -1,
            filename
          )
        ).toThrow("Invalid imageIndex: must be a non-negative integer");
      });

      it("should reject image index that is too large", () => {
        expect(() =>
          S3FolderManager.getImagePath(
            userId,
            storyId,
            episodeNumber,
            1000,
            filename
          )
        ).toThrow("Invalid imageIndex: maximum value is 999");
      });
    });

    describe("filename validation", () => {
      it("should reject empty filename", () => {
        expect(() =>
          S3FolderManager.getImagePath(
            userId,
            storyId,
            episodeNumber,
            imageIndex,
            ""
          )
        ).toThrow("Invalid filename: must be a non-empty string");
      });

      it("should reject filename with path separators", () => {
        expect(() =>
          S3FolderManager.getImagePath(
            userId,
            storyId,
            episodeNumber,
            imageIndex,
            "file/name.png"
          )
        ).toThrow("Invalid filename: cannot contain path separators");
      });

      it("should reject filename that is too long", () => {
        const longFilename = "a".repeat(252) + ".png"; // 252 + 4 = 256 characters
        expect(() =>
          S3FolderManager.getImagePath(
            userId,
            storyId,
            episodeNumber,
            imageIndex,
            longFilename
          )
        ).toThrow("Invalid filename: maximum length is 255 characters");
      });

      it("should reject filename with unsupported extension", () => {
        expect(() =>
          S3FolderManager.getImagePath(
            userId,
            storyId,
            episodeNumber,
            imageIndex,
            "file.exe"
          )
        ).toThrow("Invalid filename: unsupported file extension");
      });
    });
  });

  describe("Constants", () => {
    it("should export folder structure constants", () => {
      expect(MANGA_FOLDER_STRUCTURE).toEqual({
        stories: "stories",
        episodes: "episodes",
        images: "images",
      });
    });
  });
});
