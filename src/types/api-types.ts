/**
 * API Request/Response Types and Validation Schemas
 * These interfaces define the structure of API requests and responses
 */

import {
  UserPreferencesData,
  Story,
  Episode,
  GenerationStatus,
} from "./data-models";

// API Request Types
export interface PreferencesRequest {
  genres: string[];
  themes: string[];
  artStyle: string;
  targetAudience: string;
  contentRating: string;
}

export interface CreateStoryRequest {
  preferences: PreferencesRequest;
}

// API Response Types
export interface PreferencesResponse {
  requestId: string;
  status: GenerationStatus;
  message: string;
  timestamp: string;
}

export interface StatusResponse {
  requestId: string;
  status: GenerationStatus;
  type: "STORY" | "EPISODE" | "IMAGE";
  progress?: {
    currentStep: string;
    totalSteps: number;
    completedSteps: number;
  };
  result?: {
    storyId?: string;
    episodeId?: string;
    downloadUrl?: string;
  };
  error?: string;
  timestamp: string;
}

export interface StoriesResponse {
  stories: StoryListItem[];
  nextToken?: string;
  totalCount: number;
}

export interface StoryListItem {
  storyId: string;
  title: string;
  status: GenerationStatus;
  createdAt: string;
  episodeCount: number;
  thumbnailUrl?: string;
}

export interface StoryDetailResponse {
  story: {
    storyId: string;
    title: string;
    status: GenerationStatus;
    createdAt: string;
    updatedAt?: string;
    content?: string; // Markdown content
    downloadUrl?: string;
  };
  episodes: EpisodeListItem[];
}

export interface EpisodeListItem {
  episodeId: string;
  episodeNumber: number;
  status: GenerationStatus;
  createdAt: string;
  pdfUrl?: string;
  thumbnailUrl?: string;
}

export interface EpisodeDetailResponse {
  episode: {
    episodeId: string;
    episodeNumber: number;
    storyId: string;
    status: GenerationStatus;
    createdAt: string;
    content?: string; // Markdown content
    pdfUrl?: string;
    images?: string[]; // Array of image URLs
  };
}

// Pagination Types
export interface PaginationRequest {
  limit?: number;
  nextToken?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextToken?: string;
  totalCount?: number;
}

// Query Parameters
export interface GetStoriesQuery extends PaginationRequest {
  status?: GenerationStatus;
  sortBy?: "createdAt" | "title";
  sortOrder?: "asc" | "desc";
}

// Validation Schemas (using simple validation rules)
export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  allowedValues?: string[];
  customValidator?: (value: any) => boolean | string;
}

export interface ValidationSchema {
  [key: string]: ValidationRule;
}

// Preferences Request Validation Schema
export const preferencesRequestSchema: ValidationSchema = {
  genres: {
    required: true,
    customValidator: (value: any) => {
      if (!Array.isArray(value)) return "Genres must be an array";
      if (value.length === 0) return "At least one genre is required";
      if (value.length > 10) return "Maximum 10 genres allowed";
      return true;
    },
  },
  themes: {
    required: true,
    customValidator: (value: any) => {
      if (!Array.isArray(value)) return "Themes must be an array";
      if (value.length === 0) return "At least one theme is required";
      if (value.length > 10) return "Maximum 10 themes allowed";
      return true;
    },
  },
  artStyle: {
    required: true,
    allowedValues: ["manga", "anime", "realistic", "cartoon", "sketch"],
  },
  targetAudience: {
    required: true,
    allowedValues: ["children", "teen", "young-adult", "adult", "all-ages"],
  },
  contentRating: {
    required: true,
    allowedValues: ["G", "PG", "PG-13", "R", "NC-17"],
  },
};

// Common HTTP Status Codes
export enum HttpStatusCode {
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
}
