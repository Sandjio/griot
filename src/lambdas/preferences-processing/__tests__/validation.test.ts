import {
  validatePreferences,
  PreferenceValidators,
  ValidPreferenceOptions,
  sanitizePreferences,
} from "../validation";
import { UserPreferencesData } from "../../../types/data-models";

describe("Preference Validation", () => {
  const validPreferences: UserPreferencesData = {
    genres: ["Action", "Adventure"],
    themes: ["Friendship", "Good vs Evil"],
    artStyle: "Modern",
    targetAudience: "Young Adults",
    contentRating: "PG-13",
  };

  describe("validatePreferences", () => {
    it("should validate correct preferences", () => {
      const result = validatePreferences(validPreferences);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject null or undefined preferences", () => {
      expect(validatePreferences(null).isValid).toBe(false);
      expect(validatePreferences(undefined).isValid).toBe(false);
      expect(validatePreferences("not an object").isValid).toBe(false);
    });

    describe("Genres validation", () => {
      it("should require genres", () => {
        const prefs = { ...validPreferences };
        delete (prefs as any).genres;

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Genres are required");
      });

      it("should require genres to be an array", () => {
        const prefs = { ...validPreferences, genres: "Action" as any };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Genres must be an array");
      });

      it("should require at least one genre", () => {
        const prefs = { ...validPreferences, genres: [] };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("At least one genre must be selected");
      });

      it("should limit genres to maximum 5", () => {
        const prefs = {
          ...validPreferences,
          genres: [
            "Action",
            "Adventure",
            "Comedy",
            "Drama",
            "Fantasy",
            "Horror",
          ],
        };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Maximum 5 genres can be selected");
      });

      it("should reject invalid genres", () => {
        const prefs = {
          ...validPreferences,
          genres: ["Action", "InvalidGenre"],
        };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(
          result.errors.some((error) => error.includes("Invalid genres"))
        ).toBe(true);
      });
    });

    describe("Themes validation", () => {
      it("should require themes", () => {
        const prefs = { ...validPreferences };
        delete (prefs as any).themes;

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Themes are required");
      });

      it("should require themes to be an array", () => {
        const prefs = { ...validPreferences, themes: "Friendship" as any };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Themes must be an array");
      });

      it("should require at least one theme", () => {
        const prefs = { ...validPreferences, themes: [] };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("At least one theme must be selected");
      });

      it("should limit themes to maximum 5", () => {
        const prefs = {
          ...validPreferences,
          themes: [
            "Friendship",
            "Love",
            "Betrayal",
            "Revenge",
            "Coming of Age",
            "Good vs Evil",
          ],
        };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Maximum 5 themes can be selected");
      });

      it("should reject invalid themes", () => {
        const prefs = {
          ...validPreferences,
          themes: ["Friendship", "InvalidTheme"],
        };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(
          result.errors.some((error) => error.includes("Invalid themes"))
        ).toBe(true);
      });
    });

    describe("Art Style validation", () => {
      it("should require art style", () => {
        const prefs = { ...validPreferences };
        delete (prefs as any).artStyle;

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Art style is required");
      });

      it("should require art style to be a string", () => {
        const prefs = { ...validPreferences, artStyle: 123 as any };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Art style must be a string");
      });

      it("should reject invalid art styles", () => {
        const prefs = { ...validPreferences, artStyle: "InvalidStyle" };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Invalid art style: InvalidStyle");
      });
    });

    describe("Target Audience validation", () => {
      it("should require target audience", () => {
        const prefs = { ...validPreferences };
        delete (prefs as any).targetAudience;

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Target audience is required");
      });

      it("should require target audience to be a string", () => {
        const prefs = { ...validPreferences, targetAudience: 123 as any };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Target audience must be a string");
      });

      it("should reject invalid target audiences", () => {
        const prefs = {
          ...validPreferences,
          targetAudience: "InvalidAudience",
        };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          "Invalid target audience: InvalidAudience"
        );
      });
    });

    describe("Content Rating validation", () => {
      it("should require content rating", () => {
        const prefs = { ...validPreferences };
        delete (prefs as any).contentRating;

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Content rating is required");
      });

      it("should require content rating to be a string", () => {
        const prefs = { ...validPreferences, contentRating: 123 as any };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Content rating must be a string");
      });

      it("should reject invalid content ratings", () => {
        const prefs = { ...validPreferences, contentRating: "InvalidRating" };

        const result = validatePreferences(prefs);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          "Invalid content rating: InvalidRating"
        );
      });
    });
  });

  describe("Individual Preference Validators", () => {
    describe("PreferenceValidators.genres", () => {
      it("should validate valid genres", () => {
        const result = PreferenceValidators.genres(["Action", "Adventure"]);
        expect(result.isValid).toBe(true);
      });

      it("should reject non-array input", () => {
        const result = PreferenceValidators.genres("Action");
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Genres must be an array");
      });
    });

    describe("PreferenceValidators.themes", () => {
      it("should validate valid themes", () => {
        const result = PreferenceValidators.themes(["Friendship", "Love"]);
        expect(result.isValid).toBe(true);
      });

      it("should reject non-array input", () => {
        const result = PreferenceValidators.themes("Friendship");
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Themes must be an array");
      });
    });

    describe("PreferenceValidators.artStyle", () => {
      it("should validate valid art style", () => {
        const result = PreferenceValidators.artStyle("Modern");
        expect(result.isValid).toBe(true);
      });

      it("should reject invalid art style", () => {
        const result = PreferenceValidators.artStyle("InvalidStyle");
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Invalid art style: InvalidStyle");
      });
    });

    describe("PreferenceValidators.targetAudience", () => {
      it("should validate valid target audience", () => {
        const result = PreferenceValidators.targetAudience("Young Adults");
        expect(result.isValid).toBe(true);
      });

      it("should reject invalid target audience", () => {
        const result = PreferenceValidators.targetAudience("InvalidAudience");
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          "Invalid target audience: InvalidAudience"
        );
      });
    });

    describe("PreferenceValidators.contentRating", () => {
      it("should validate valid content rating", () => {
        const result = PreferenceValidators.contentRating("PG-13");
        expect(result.isValid).toBe(true);
      });

      it("should reject invalid content rating", () => {
        const result = PreferenceValidators.contentRating("InvalidRating");
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          "Invalid content rating: InvalidRating"
        );
      });
    });
  });

  describe("ValidPreferenceOptions", () => {
    it("should provide valid genre options", () => {
      expect(ValidPreferenceOptions.genres).toContain("Action");
      expect(ValidPreferenceOptions.genres).toContain("Adventure");
      expect(ValidPreferenceOptions.genres).toContain("Comedy");
    });

    it("should provide valid theme options", () => {
      expect(ValidPreferenceOptions.themes).toContain("Friendship");
      expect(ValidPreferenceOptions.themes).toContain("Love");
      expect(ValidPreferenceOptions.themes).toContain("Good vs Evil");
    });

    it("should provide valid art style options", () => {
      expect(ValidPreferenceOptions.artStyles).toContain("Modern");
      expect(ValidPreferenceOptions.artStyles).toContain("Traditional");
      expect(ValidPreferenceOptions.artStyles).toContain("Minimalist");
    });

    it("should provide valid target audience options", () => {
      expect(ValidPreferenceOptions.targetAudiences).toContain("Young Adults");
      expect(ValidPreferenceOptions.targetAudiences).toContain("Teens");
      expect(ValidPreferenceOptions.targetAudiences).toContain("Adults");
    });

    it("should provide valid content rating options", () => {
      expect(ValidPreferenceOptions.contentRatings).toContain("PG-13");
      expect(ValidPreferenceOptions.contentRatings).toContain("G");
      expect(ValidPreferenceOptions.contentRatings).toContain("R");
    });
  });

  describe("sanitizePreferences", () => {
    it("should sanitize valid preferences", () => {
      const result = sanitizePreferences(validPreferences);
      expect(result).toEqual(validPreferences);
    });

    it("should remove invalid genres", () => {
      const prefs = {
        ...validPreferences,
        genres: ["Action", "InvalidGenre", "Adventure"],
      };

      const result = sanitizePreferences(prefs);
      expect(result.genres).toEqual(["Action", "Adventure"]);
    });

    it("should limit genres to 5", () => {
      const prefs = {
        ...validPreferences,
        genres: ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror"],
      };

      const result = sanitizePreferences(prefs);
      expect(result.genres).toHaveLength(5);
    });

    it("should remove invalid themes", () => {
      const prefs = {
        ...validPreferences,
        themes: ["Friendship", "InvalidTheme", "Love"],
      };

      const result = sanitizePreferences(prefs);
      expect(result.themes).toEqual(["Friendship", "Love"]);
    });

    it("should limit themes to 5", () => {
      const prefs = {
        ...validPreferences,
        themes: [
          "Friendship",
          "Love",
          "Betrayal",
          "Revenge",
          "Coming of Age",
          "Good vs Evil",
        ],
      };

      const result = sanitizePreferences(prefs);
      expect(result.themes).toHaveLength(5);
    });

    it("should remove invalid art style", () => {
      const prefs = {
        ...validPreferences,
        artStyle: "InvalidStyle",
      };

      const result = sanitizePreferences(prefs);
      expect(result.artStyle).toBeUndefined();
    });

    it("should remove invalid target audience", () => {
      const prefs = {
        ...validPreferences,
        targetAudience: "InvalidAudience",
      };

      const result = sanitizePreferences(prefs);
      expect(result.targetAudience).toBeUndefined();
    });

    it("should remove invalid content rating", () => {
      const prefs = {
        ...validPreferences,
        contentRating: "InvalidRating",
      };

      const result = sanitizePreferences(prefs);
      expect(result.contentRating).toBeUndefined();
    });

    it("should handle non-object input", () => {
      const result = sanitizePreferences("not an object");
      expect(result).toEqual({});
    });

    it("should handle null/undefined input", () => {
      expect(sanitizePreferences(null)).toEqual({});
      expect(sanitizePreferences(undefined)).toEqual({});
    });
  });
});
