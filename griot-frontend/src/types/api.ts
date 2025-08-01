// API related types and interfaces

export interface ApiClient {
  get<T>(endpoint: string): Promise<T>;
  post<T>(endpoint: string, data: unknown): Promise<T>;
  put<T>(endpoint: string, data: unknown): Promise<T>;
  delete<T>(endpoint: string): Promise<T>;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
  timestamp: string;
}

// Extended API Error for internal use
export enum ApiErrorType {
  NETWORK_ERROR = "NETWORK_ERROR",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  SERVER_ERROR = "SERVER_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export interface ExtendedApiError extends ApiError {
  type: ApiErrorType;
  status?: number;
  retryable: boolean;
}

// User Preferences
export type ArtStyle =
  | "Traditional"
  | "Modern"
  | "Minimalist"
  | "Detailed"
  | "Cartoon"
  | "Realistic"
  | "Chibi"
  | "Dark"
  | "Colorful"
  | "Black and White";

export type TargetAudience =
  | "Children"
  | "Teens"
  | "Young Adults"
  | "Adults"
  | "All Ages";

export type ContentRating = "G" | "PG" | "PG-13" | "R";

export interface UserPreferences {
  genres: string[];
  themes: string[];
  artStyle: ArtStyle;
  targetAudience: TargetAudience;
  contentRating: ContentRating;
}

// Manga Generation Types
export type MangaCategory =
  | "Adventure"
  | "Romance"
  | "Fantasy"
  | "Sci-Fi"
  | "Mystery"
  | "Horror";

export interface MangaGenerationRequest {
  category: MangaCategory;
  preferences?: UserPreferences;
}

export interface MangaGenerationResponse {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  category: MangaCategory;
  story?: {
    title: string;
    synopsis: string;
    chapters: Array<{
      title: string;
      content: string;
      imageUrl?: string;
    }>;
  };
  images?: Array<{
    id: string;
    url: string;
    description: string;
    chapterIndex: number;
  }>;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface MangaGenerationStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number; // 0-100
  currentStep: string;
  estimatedTimeRemaining?: number; // in seconds
  error?: string;
}

// Environment Configuration
export interface EnvironmentConfig {
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: string;
  NEXT_PUBLIC_COGNITO_CLIENT_ID: string;
  NEXT_PUBLIC_COGNITO_DOMAIN: string;
  NEXT_PUBLIC_API_BASE_URL: string;
  NEXT_PUBLIC_ENVIRONMENT: "development" | "staging" | "production";
  NEXT_PUBLIC_APP_URL: string;
}
