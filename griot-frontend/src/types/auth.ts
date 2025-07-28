// Authentication related types and interfaces

export interface User {
  id: string;
  email: string;
  username: string;
  hasPreferences: boolean;
}

export interface TokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthState {
  status: "loading" | "authenticated" | "unauthenticated";
  user: User | null;
  tokens: TokenSet | null;
  error: string | null;
}

export interface UserSession {
  user: User;
  tokens: TokenSet;
  lastRefresh: number;
  expiresAt: number;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
  refreshTokens: () => Promise<boolean>;
  hasValidTokens: () => boolean;
}

// Cognito Configuration
export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  domain: string;
  redirectUri: string;
  logoutUri: string;
  scopes: string[];
}

// OAuth Flow Data
export interface AuthorizationRequest {
  response_type: "code";
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
}

export interface TokenRequest {
  grant_type: "authorization_code" | "refresh_token";
  client_id: string;
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
}

export interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

// Error handling
export enum AuthErrorType {
  INVALID_TOKEN = "INVALID_TOKEN",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  REFRESH_FAILED = "REFRESH_FAILED",
  NETWORK_ERROR = "NETWORK_ERROR",
  COGNITO_ERROR = "COGNITO_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
}

export interface AuthError {
  type: AuthErrorType;
  message: string;
  details?: unknown;
  recoverable: boolean;
}
