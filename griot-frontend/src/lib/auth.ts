import {
  TokenSet,
  TokenResponse,
  AuthError,
  AuthErrorType,
  CognitoConfig,
  User,
} from "@/types/auth";
import { cognitoConfig } from "./config";

// Constants for token management
const TOKEN_STORAGE_KEY = "griot_tokens";
const USER_STORAGE_KEY = "griot_user";
const ENCRYPTION_KEY = "griot_auth_key";

/**
 * Secure storage utilities with encryption fallback
 */
export class SecureStorage {
  private static isLocalStorageAvailable(): boolean {
    try {
      const test = "__localStorage_test__";
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  private static encrypt(data: string): string {
    // Simple XOR encryption for fallback (in production, use proper encryption)
    const key = ENCRYPTION_KEY;
    let encrypted = "";
    for (let i = 0; i < data.length; i++) {
      encrypted += String.fromCharCode(
        data.charCodeAt(i) ^ key.charCodeAt(i % key.length)
      );
    }
    return btoa(encrypted);
  }

  private static decrypt(encryptedData: string): string {
    try {
      const data = atob(encryptedData);
      const key = ENCRYPTION_KEY;
      let decrypted = "";
      for (let i = 0; i < data.length; i++) {
        decrypted += String.fromCharCode(
          data.charCodeAt(i) ^ key.charCodeAt(i % key.length)
        );
      }
      return decrypted;
    } catch {
      return "";
    }
  }

  static setItem(key: string, value: string): void {
    if (this.isLocalStorageAvailable()) {
      try {
        localStorage.setItem(key, this.encrypt(value));
      } catch (error) {
        console.warn("Failed to store in localStorage:", error);
      }
    }
  }

  static getItem(key: string): string | null {
    if (this.isLocalStorageAvailable()) {
      try {
        const item = localStorage.getItem(key);
        return item ? this.decrypt(item) : null;
      } catch (error) {
        console.warn("Failed to retrieve from localStorage:", error);
        return null;
      }
    }
    return null;
  }

  static removeItem(key: string): void {
    if (this.isLocalStorageAvailable()) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn("Failed to remove from localStorage:", error);
      }
    }
  }

  static clear(): void {
    if (this.isLocalStorageAvailable()) {
      try {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
      } catch (error) {
        console.warn("Failed to clear localStorage:", error);
      }
    }
  }
}

/**
 * Token management functions
 */
export class TokenManager {
  /**
   * Store tokens securely in both localStorage and cookies
   */
  static storeTokens(tokens: TokenSet): void {
    try {
      const tokenData = JSON.stringify(tokens);
      SecureStorage.setItem(TOKEN_STORAGE_KEY, tokenData);

      // Also store in cookie for middleware access
      if (typeof document !== "undefined") {
        // Set cookie with same expiration as tokens (30 days max for refresh token)
        const expires = new Date(tokens.expiresAt + 30 * 24 * 60 * 60 * 1000); // 30 days from token expiry
        document.cookie = `griot_tokens=${encodeURIComponent(
          tokenData
        )}; expires=${expires.toUTCString()}; path=/; secure; samesite=strict`;
      }
    } catch (error) {
      console.error("Failed to store tokens:", error);
      const authError: AuthError = {
        type: AuthErrorType.VALIDATION_ERROR,
        message: "Failed to store authentication tokens",
        details: error instanceof Error ? error : String(error),
        recoverable: false,
      };
      throw authError;
    }
  }

  /**
   * Retrieve stored tokens
   */
  static retrieveTokens(): TokenSet | null {
    try {
      const tokenData = SecureStorage.getItem(TOKEN_STORAGE_KEY);
      if (!tokenData) return null;

      const tokens = JSON.parse(tokenData) as TokenSet;

      // Validate token structure
      if (!tokens.accessToken || !tokens.idToken || !tokens.refreshToken) {
        this.clearTokens();
        return null;
      }

      return tokens;
    } catch (error) {
      console.error("Failed to retrieve tokens:", error);
      this.clearTokens();
      return null;
    }
  }

  /**
   * Validate if tokens are still valid
   */
  static validateTokens(tokens: TokenSet): boolean {
    if (
      !tokens ||
      !tokens.accessToken ||
      !tokens.idToken ||
      !tokens.refreshToken
    ) {
      return false;
    }

    // Check if tokens are expired (with 5-minute buffer)
    const now = Date.now();
    const buffer = 5 * 60 * 1000; // 5 minutes

    return tokens.expiresAt > now + buffer;
  }

  /**
   * Check if tokens need refresh (within 10 minutes of expiry)
   */
  static needsRefresh(tokens: TokenSet): boolean {
    if (!tokens) return false;

    const now = Date.now();
    const refreshBuffer = 10 * 60 * 1000; // 10 minutes

    return tokens.expiresAt <= now + refreshBuffer;
  }

  /**
   * Refresh tokens using refresh token
   */
  static async refreshTokens(refreshToken: string): Promise<TokenSet> {
    try {
      // Handle domain with or without protocol
      const baseUrl = cognitoConfig.domain.startsWith("http")
        ? cognitoConfig.domain
        : `https://${cognitoConfig.domain}`;
      const tokenEndpoint = `${baseUrl}/oauth2/token`;

      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cognitoConfig.clientId,
        refresh_token: refreshToken,
      });

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const authError: AuthError = {
          type: AuthErrorType.REFRESH_FAILED,
          message: errorData.error_description || "Token refresh failed",
          details: errorData,
          recoverable: false,
        };
        throw authError;
      }

      const tokenResponse: TokenResponse = await response.json();

      // Convert to TokenSet format
      const tokens: TokenSet = {
        accessToken: tokenResponse.access_token,
        idToken: tokenResponse.id_token,
        refreshToken: tokenResponse.refresh_token || refreshToken, // Keep old refresh token if new one not provided
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      };

      // Store the new tokens
      this.storeTokens(tokens);

      return tokens;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        "recoverable" in error
      ) {
        throw error as AuthError;
      }

      const authError: AuthError = {
        type: AuthErrorType.NETWORK_ERROR,
        message: "Network error during token refresh",
        details: error instanceof Error ? error : String(error),
        recoverable: true,
      };
      throw authError;
    }
  }

  /**
   * Clear stored tokens from both localStorage and cookies
   */
  static clearTokens(): void {
    SecureStorage.removeItem(TOKEN_STORAGE_KEY);

    // Also clear cookie
    if (typeof document !== "undefined") {
      document.cookie =
        "griot_tokens=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    }
  }

  /**
   * Get access token for API requests
   */
  static getAccessToken(): string | null {
    const tokens = this.retrieveTokens();
    if (!tokens || !this.validateTokens(tokens)) {
      return null;
    }
    return tokens.accessToken;
  }
}

/**
 * User management functions
 */
export class UserManager {
  /**
   * Store user data in both localStorage and cookies
   */
  static storeUser(user: User): void {
    try {
      const userData = JSON.stringify(user);
      SecureStorage.setItem(USER_STORAGE_KEY, userData);

      // Also store in cookie for middleware access
      if (typeof document !== "undefined") {
        // Set cookie with 30 day expiration (same as refresh token)
        const expires = new Date();
        expires.setDate(expires.getDate() + 30);
        document.cookie = `griot_user=${encodeURIComponent(
          userData
        )}; expires=${expires.toUTCString()}; path=/; secure; samesite=strict`;
      }
    } catch (error) {
      console.error("Failed to store user data:", error);
    }
  }

  /**
   * Retrieve stored user data
   */
  static retrieveUser(): User | null {
    try {
      const userData = SecureStorage.getItem(USER_STORAGE_KEY);
      if (!userData) return null;

      return JSON.parse(userData) as User;
    } catch (error) {
      console.error("Failed to retrieve user data:", error);
      this.clearUser();
      return null;
    }
  }

  /**
   * Clear stored user data from both localStorage and cookies
   */
  static clearUser(): void {
    SecureStorage.removeItem(USER_STORAGE_KEY);

    // Also clear cookie
    if (typeof document !== "undefined") {
      document.cookie =
        "griot_user=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    }
  }

  /**
   * Extract user info from ID token
   */
  static extractUserFromIdToken(idToken: string): User | null {
    try {
      // Decode JWT payload (simple base64 decode - in production use proper JWT library)
      const payload = idToken.split(".")[1];
      const decodedPayload = JSON.parse(atob(payload));

      return {
        id: decodedPayload.sub || decodedPayload["cognito:username"],
        email: decodedPayload.email,
        username:
          decodedPayload["cognito:username"] ||
          decodedPayload.preferred_username,
        hasPreferences: false, // Will be updated after checking preferences API
      };
    } catch (error) {
      console.error("Failed to extract user from ID token:", error);
      return null;
    }
  }
}

/**
 * Cognito OAuth utilities
 */
export class CognitoOAuth {
  /**
   * Generate a secure random state parameter for CSRF protection
   */
  private static generateState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
      ""
    );
  }

  /**
   * Store state parameter for validation
   */
  private static storeState(state: string): void {
    SecureStorage.setItem("oauth_state", state);
  }

  /**
   * Retrieve and validate state parameter
   */
  static validateState(receivedState: string): boolean {
    const storedState = SecureStorage.getItem("oauth_state");
    SecureStorage.removeItem("oauth_state"); // Remove after use
    return storedState === receivedState;
  }

  /**
   * Generate Cognito OAuth authorization URL for login
   */
  static generateLoginUrl(config: CognitoConfig = cognitoConfig): string {
    const state = this.generateState();
    this.storeState(state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(" "),
      state: state,
    });

    // Handle domain with or without protocol
    const baseUrl = config.domain.startsWith("http")
      ? config.domain
      : `https://${config.domain}`;
    return `${baseUrl}/login?${params.toString()}`;
  }

  /**
   * Generate Cognito OAuth authorization URL for signup
   */
  static generateSignupUrl(config: CognitoConfig = cognitoConfig): string {
    const state = this.generateState();
    this.storeState(state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(" "),
      state: state,
    });

    // Handle domain with or without protocol
    const baseUrl = config.domain.startsWith("http")
      ? config.domain
      : `https://${config.domain}`;
    return `${baseUrl}/signup?${params.toString()}`;
  }

  /**
   * Generate Cognito logout URL
   */
  static generateLogoutUrl(config: CognitoConfig = cognitoConfig): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      logout_uri: config.logoutUri,
    });

    // Handle domain with or without protocol
    const baseUrl = config.domain.startsWith("http")
      ? config.domain
      : `https://${config.domain}`;
    return `${baseUrl}/logout?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  static async exchangeCodeForTokens(
    code: string,
    config: CognitoConfig = cognitoConfig
  ): Promise<TokenSet> {
    try {
      // Handle domain with or without protocol
      const baseUrl = config.domain.startsWith("http")
        ? config.domain
        : `https://${config.domain}`;
      const tokenEndpoint = `${baseUrl}/oauth2/token`;

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code: code,
        redirect_uri: config.redirectUri,
      });

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const authError: AuthError = {
          type: AuthErrorType.COGNITO_ERROR,
          message:
            errorData.error_description || "Authorization code exchange failed",
          details: errorData,
          recoverable: false,
        };
        throw authError;
      }

      const tokenResponse: TokenResponse = await response.json();

      // Convert to TokenSet format
      const tokens: TokenSet = {
        accessToken: tokenResponse.access_token,
        idToken: tokenResponse.id_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      };

      return tokens;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        "recoverable" in error
      ) {
        throw error as AuthError;
      }

      const authError: AuthError = {
        type: AuthErrorType.NETWORK_ERROR,
        message: "Network error during token exchange",
        details: error instanceof Error ? error : String(error),
        recoverable: true,
      };
      throw authError;
    }
  }

  /**
   * Validate OAuth callback parameters
   */
  static validateCallbackParams(searchParams: URLSearchParams): {
    isValid: boolean;
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  } {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description") ?? undefined;

    // Check for OAuth errors
    if (error) {
      return {
        isValid: false,
        error,
        errorDescription,
      };
    }

    // Check for required parameters
    if (!code || !state) {
      return {
        isValid: false,
        error: "missing_parameters",
        errorDescription: "Missing required OAuth parameters",
      };
    }

    // Validate state parameter
    if (!this.validateState(state)) {
      return {
        isValid: false,
        error: "invalid_state",
        errorDescription: "Invalid state parameter - possible CSRF attack",
      };
    }

    return {
      isValid: true,
      code,
      state,
    };
  }
}

/**
 * Main authentication utilities class
 */
export class AuthUtils {
  /**
   * Redirect to Cognito login page
   */
  static login(): void {
    const loginUrl = CognitoOAuth.generateLoginUrl();
    window.location.href = loginUrl;
  }

  /**
   * Redirect to Cognito signup page
   */
  static signup(): void {
    const signupUrl = CognitoOAuth.generateSignupUrl();
    window.location.href = signupUrl;
  }

  /**
   * Logout user - clear tokens and redirect to Cognito logout
   */
  static logout(): void {
    // Clear local storage
    TokenManager.clearTokens();
    UserManager.clearUser();
    SecureStorage.clear();

    // Redirect to Cognito logout
    const logoutUrl = CognitoOAuth.generateLogoutUrl();
    console.log("Generated logout URL:", logoutUrl);
    window.location.href = logoutUrl;
  }

  /**
   * Check if user is authenticated
   */
  static isAuthenticated(): boolean {
    const tokens = TokenManager.retrieveTokens();
    return tokens !== null && TokenManager.validateTokens(tokens);
  }

  /**
   * Get current user
   */
  static getCurrentUser(): User | null {
    if (!this.isAuthenticated()) {
      return null;
    }
    return UserManager.retrieveUser();
  }

  /**
   * Handle OAuth callback
   */
  static async handleCallback(searchParams: URLSearchParams): Promise<{
    success: boolean;
    user?: User;
    error?: AuthError;
  }> {
    try {
      // Validate callback parameters
      const validation = CognitoOAuth.validateCallbackParams(searchParams);

      if (!validation.isValid) {
        const authError: AuthError = {
          type: AuthErrorType.COGNITO_ERROR,
          message:
            validation.errorDescription || "OAuth callback validation failed",
          details: { error: validation.error },
          recoverable: false,
        };
        throw authError;
      }

      // Exchange code for tokens
      const tokens = await CognitoOAuth.exchangeCodeForTokens(validation.code!);

      // Store tokens
      TokenManager.storeTokens(tokens);

      // Extract user from ID token
      const user = UserManager.extractUserFromIdToken(tokens.idToken);
      if (!user) {
        const authError: AuthError = {
          type: AuthErrorType.VALIDATION_ERROR,
          message: "Failed to extract user information from tokens",
          details: undefined,
          recoverable: false,
        };
        throw authError;
      }

      // Store user
      UserManager.storeUser(user);

      return {
        success: true,
        user,
      };
    } catch (error) {
      // Clean up on error
      TokenManager.clearTokens();
      UserManager.clearUser();

      return {
        success: false,
        error:
          error instanceof Error && "type" in error && "recoverable" in error
            ? (error as AuthError)
            : {
                type: AuthErrorType.VALIDATION_ERROR,
                message: "Unexpected error during callback handling",
                details: error instanceof Error ? error : String(error),
                recoverable: false,
              },
      };
    }
  }

  /**
   * Refresh tokens if needed
   */
  static async refreshTokensIfNeeded(): Promise<boolean> {
    try {
      const tokens = TokenManager.retrieveTokens();
      if (!tokens) return false;

      // Check if refresh is needed
      if (!TokenManager.needsRefresh(tokens)) {
        return true; // Tokens are still valid
      }

      // Attempt to refresh
      const newTokens = await TokenManager.refreshTokens(tokens.refreshToken);

      // Update user info if needed
      const user = UserManager.extractUserFromIdToken(newTokens.idToken);
      if (user) {
        UserManager.storeUser(user);
      }

      return true;
    } catch (error) {
      console.error("Token refresh failed:", error);
      // Clear invalid tokens
      TokenManager.clearTokens();
      UserManager.clearUser();
      return false;
    }
  }
}
