import { UserPreferencesData } from "../../types/data-models";

/**
 * Validation utilities for user preferences
 *
 * Validates user preference data according to business rules
 * Requirements: 2.1
 */

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Valid options for each preference field
const VALID_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
  "Historical",
  "Psychological",
  "Mecha",
  "Isekai",
  "School Life",
  "Military",
  "Music",
];

const VALID_THEMES = [
  "Friendship",
  "Love",
  "Betrayal",
  "Revenge",
  "Coming of Age",
  "Good vs Evil",
  "Sacrifice",
  "Redemption",
  "Power",
  "Family",
  "Honor",
  "Justice",
  "Freedom",
  "Survival",
  "Identity",
  "Destiny",
  "War",
  "Peace",
  "Magic",
  "Technology",
];

const VALID_ART_STYLES = [
  "Traditional",
  "Modern",
  "Minimalist",
  "Detailed",
  "Cartoon",
  "Realistic",
  "Chibi",
  "Dark",
  "Colorful",
  "Black and White",
];

const VALID_TARGET_AUDIENCES = [
  "Children",
  "Teens",
  "Young Adults",
  "Adults",
  "All Ages",
];

const VALID_CONTENT_RATINGS = [
  "G", // General Audiences
  "PG", // Parental Guidance
  "PG-13", // Parents Strongly Cautioned
  "R", // Restricted
  "NC-17", // Adults Only
];

/**
 * Validate user preferences data
 */
export function validatePreferences(preferences: any): ValidationResult {
  const errors: string[] = [];

  // Check if preferences is an object
  if (!preferences || typeof preferences !== "object") {
    return {
      isValid: false,
      errors: ["Preferences must be a valid object"],
    };
  }

  // Validate genres
  if (!preferences.genres) {
    errors.push("Genres are required");
  } else if (!Array.isArray(preferences.genres)) {
    errors.push("Genres must be an array");
  } else if (preferences.genres.length === 0) {
    errors.push("At least one genre must be selected");
  } else if (preferences.genres.length > 5) {
    errors.push("Maximum 5 genres can be selected");
  } else {
    const invalidGenres = preferences.genres.filter(
      (genre: any) => typeof genre !== "string" || !VALID_GENRES.includes(genre)
    );
    if (invalidGenres.length > 0) {
      errors.push(`Invalid genres: ${invalidGenres.join(", ")}`);
    }
  }

  // Validate themes
  if (!preferences.themes) {
    errors.push("Themes are required");
  } else if (!Array.isArray(preferences.themes)) {
    errors.push("Themes must be an array");
  } else if (preferences.themes.length === 0) {
    errors.push("At least one theme must be selected");
  } else if (preferences.themes.length > 5) {
    errors.push("Maximum 5 themes can be selected");
  } else {
    const invalidThemes = preferences.themes.filter(
      (theme: any) => typeof theme !== "string" || !VALID_THEMES.includes(theme)
    );
    if (invalidThemes.length > 0) {
      errors.push(`Invalid themes: ${invalidThemes.join(", ")}`);
    }
  }

  // Validate art style
  if (!preferences.artStyle) {
    errors.push("Art style is required");
  } else if (typeof preferences.artStyle !== "string") {
    errors.push("Art style must be a string");
  } else if (!VALID_ART_STYLES.includes(preferences.artStyle)) {
    errors.push(`Invalid art style: ${preferences.artStyle}`);
  }

  // Validate target audience
  if (!preferences.targetAudience) {
    errors.push("Target audience is required");
  } else if (typeof preferences.targetAudience !== "string") {
    errors.push("Target audience must be a string");
  } else if (!VALID_TARGET_AUDIENCES.includes(preferences.targetAudience)) {
    errors.push(`Invalid target audience: ${preferences.targetAudience}`);
  }

  // Validate content rating
  if (!preferences.contentRating) {
    errors.push("Content rating is required");
  } else if (typeof preferences.contentRating !== "string") {
    errors.push("Content rating must be a string");
  } else if (!VALID_CONTENT_RATINGS.includes(preferences.contentRating)) {
    errors.push(`Invalid content rating: ${preferences.contentRating}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate individual preference fields
 */
export const PreferenceValidators = {
  genres: (genres: any): ValidationResult => {
    const errors: string[] = [];

    if (!Array.isArray(genres)) {
      errors.push("Genres must be an array");
    } else if (genres.length === 0) {
      errors.push("At least one genre must be selected");
    } else if (genres.length > 5) {
      errors.push("Maximum 5 genres can be selected");
    } else {
      const invalidGenres = genres.filter(
        (genre: any) =>
          typeof genre !== "string" || !VALID_GENRES.includes(genre)
      );
      if (invalidGenres.length > 0) {
        errors.push(`Invalid genres: ${invalidGenres.join(", ")}`);
      }
    }

    return { isValid: errors.length === 0, errors };
  },

  themes: (themes: any): ValidationResult => {
    const errors: string[] = [];

    if (!Array.isArray(themes)) {
      errors.push("Themes must be an array");
    } else if (themes.length === 0) {
      errors.push("At least one theme must be selected");
    } else if (themes.length > 5) {
      errors.push("Maximum 5 themes can be selected");
    } else {
      const invalidThemes = themes.filter(
        (theme: any) =>
          typeof theme !== "string" || !VALID_THEMES.includes(theme)
      );
      if (invalidThemes.length > 0) {
        errors.push(`Invalid themes: ${invalidThemes.join(", ")}`);
      }
    }

    return { isValid: errors.length === 0, errors };
  },

  artStyle: (artStyle: any): ValidationResult => {
    const errors: string[] = [];

    if (typeof artStyle !== "string") {
      errors.push("Art style must be a string");
    } else if (!VALID_ART_STYLES.includes(artStyle)) {
      errors.push(`Invalid art style: ${artStyle}`);
    }

    return { isValid: errors.length === 0, errors };
  },

  targetAudience: (targetAudience: any): ValidationResult => {
    const errors: string[] = [];

    if (typeof targetAudience !== "string") {
      errors.push("Target audience must be a string");
    } else if (!VALID_TARGET_AUDIENCES.includes(targetAudience)) {
      errors.push(`Invalid target audience: ${targetAudience}`);
    }

    return { isValid: errors.length === 0, errors };
  },

  contentRating: (contentRating: any): ValidationResult => {
    const errors: string[] = [];

    if (typeof contentRating !== "string") {
      errors.push("Content rating must be a string");
    } else if (!VALID_CONTENT_RATINGS.includes(contentRating)) {
      errors.push(`Invalid content rating: ${contentRating}`);
    }

    return { isValid: errors.length === 0, errors };
  },
};

/**
 * Get valid options for each preference field
 */
export const ValidPreferenceOptions = {
  genres: VALID_GENRES,
  themes: VALID_THEMES,
  artStyles: VALID_ART_STYLES,
  targetAudiences: VALID_TARGET_AUDIENCES,
  contentRatings: VALID_CONTENT_RATINGS,
} as const;

/**
 * Sanitize preferences by removing invalid values
 */
export function sanitizePreferences(
  preferences: any
): Partial<UserPreferencesData> {
  const sanitized: Partial<UserPreferencesData> = {};

  // Check if preferences is a valid object
  if (!preferences || typeof preferences !== "object") {
    return sanitized;
  }

  // Sanitize genres
  if (Array.isArray(preferences.genres)) {
    const validGenres = preferences.genres.filter(
      (genre: any) => typeof genre === "string" && VALID_GENRES.includes(genre)
    );
    if (validGenres.length > 0) {
      sanitized.genres = validGenres.slice(0, 5); // Limit to 5
    }
  }

  // Sanitize themes
  if (Array.isArray(preferences.themes)) {
    const validThemes = preferences.themes.filter(
      (theme: any) => typeof theme === "string" && VALID_THEMES.includes(theme)
    );
    if (validThemes.length > 0) {
      sanitized.themes = validThemes.slice(0, 5); // Limit to 5
    }
  }

  // Sanitize art style
  if (
    typeof preferences.artStyle === "string" &&
    VALID_ART_STYLES.includes(preferences.artStyle)
  ) {
    sanitized.artStyle = preferences.artStyle;
  }

  // Sanitize target audience
  if (
    typeof preferences.targetAudience === "string" &&
    VALID_TARGET_AUDIENCES.includes(preferences.targetAudience)
  ) {
    sanitized.targetAudience = preferences.targetAudience;
  }

  // Sanitize content rating
  if (
    typeof preferences.contentRating === "string" &&
    VALID_CONTENT_RATINGS.includes(preferences.contentRating)
  ) {
    sanitized.contentRating = preferences.contentRating;
  }

  return sanitized;
}
