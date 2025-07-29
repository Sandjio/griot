import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SecureStorage,
  TokenManager,
  UserManager,
  CognitoOAuth,
  AuthUtils,
} from "../auth";
import { TokenSet, User, AuthErrorType, CognitoConfig } from "@/types/auth";

// Mock config
vi.mock("../config", () => ({
  cognitoConfig: {
    userPoolId: "us-east-1_test123",
    clientId: "test-client-id",
    domain: "test-domain.auth.us-east-1.amazoncognito.com",
    redirectUri: "http://localhost:3000/callback",
    logoutUri: "http://localhost:3000",
    scopes: ["openid", "email", "profile"],
  },
}));

describe("SecureStorage", () => {
  beforeEach(() => {
    // Clear localStorage mock
    vi.clearAllMocks();
    // Reset localStorage mock to working state
    (localStorage.setItem as any).mockImplementation(
      (key: string, value: string) => {
        // Store in a simple object for testing
        (localStorage as any)[key] = value;
      }
    );
    (localStorage.getItem as any).mockImplementation((key: string) => {
      return (localStorage as any)[key] || null;
    });
    (localStorage.removeItem as any).mockImplementation((key: string) => {
      delete (localStorage as any)[key];
    });
  });

  describe("setItem", () => {
    it("should store encrypted data in localStorage", () => {
      const key = "test-key";
      const value = "test-value";

      SecureStorage.setItem(key, value);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        key,
        expect.any(String)
      );
      // Verify the stored value is encrypted (not plain text)
      const storedValue = (localStorage.setItem as any).mock.calls[0][1];
      expect(storedValue).not.toBe(value);
    });

    it("should handle localStorage errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      (localStorage.setItem as any).mockImplementation(() => {
        throw new Error("Storage error");
      });

      expect(() => SecureStorage.setItem("key", "value")).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to store in localStorage:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("getItem", () => {
    it("should retrieve and decrypt data from localStorage", () => {
      const key = "test-key";
      const value = "test-value";

      // First store the value
      SecureStorage.setItem(key, value);
      const encryptedValue = (localStorage.setItem as any).mock.calls[0][1];

      // Mock localStorage.getItem to return the encrypted value
      (localStorage.getItem as any).mockReturnValue(encryptedValue);

      const result = SecureStorage.getItem(key);
      expect(result).toBe(value);
    });

    it("should return null when item does not exist", () => {
      (localStorage.getItem as any).mockReturnValue(null);

      const result = SecureStorage.getItem("non-existent-key");
      expect(result).toBeNull();
    });

    it("should handle decryption errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      (localStorage.getItem as any).mockReturnValue("invalid-encrypted-data");

      const result = SecureStorage.getItem("key");
      expect(result).toBe("");
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to retrieve from localStorage:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe("removeItem", () => {
    it("should remove item from localStorage", () => {
      SecureStorage.removeItem("test-key");
      expect(localStorage.removeItem).toHaveBeenCalledWith("test-key");
    });
  });

  describe("clear", () => {
    it("should clear authentication-related items", () => {
      SecureStorage.clear();
      expect(localStorage.removeItem).toHaveBeenCalledWith("griot_tokens");
      expect(localStorage.removeItem).toHaveBeenCalledWith("griot_user");
    });
  });
});

describe("TokenManager", () => {
  const mockTokens: TokenSet = {
    accessToken: "access-token-123",
    idToken: "id-token-123",
    refreshToken: "refresh-token-123",
    expiresAt: Date.now() + 3600000, // 1 hour from now
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock document.cookie
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "",
    });
  });

  describe("storeTokens", () => {
    it("should store tokens in localStorage and cookies", () => {
      TokenManager.storeTokens(mockTokens);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        "griot_tokens",
        expect.any(String)
      );
      // Check that cookie was set
      expect(document.cookie).toContain("griot_tokens=");
    });

    it("should throw error when token storage fails", () => {
      (localStorage.setItem as any).mockImplementation(() => {
        throw new Error("Storage error");
      });

      expect(() => TokenManager.storeTokens(mockTokens)).toThrow();
    });
  });

  describe("retrieveTokens", () => {
    it("should retrieve valid tokens", () => {
      // Mock localStorage to return valid token data
      const tokenData = JSON.stringify(mockTokens);
      (localStorage.getItem as any).mockReturnValue(btoa(tokenData));

      const result = TokenManager.retrieveTokens();
      expect(result).toEqual(mockTokens);
    });

    it("should return null when no tokens exist", () => {
      (localStorage.getItem as any).mockReturnValue(null);

      const result = TokenManager.retrieveTokens();
      expect(result).toBeNull();
    });

    it("should clear tokens and return null for invalid data", () => {
      (localStorage.getItem as any).mockReturnValue("invalid-data");

      const result = TokenManager.retrieveTokens();
      expect(result).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith("griot_tokens");
    });

    it("should clear tokens when required fields are missing", () => {
      const incompleteTokens = { accessToken: "token" };
      const tokenData = JSON.stringify(incompleteTokens);
      (localStorage.getItem as any).mockReturnValue(btoa(tokenData));

      const result = TokenManager.retrieveTokens();
      expect(result).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith("griot_tokens");
    });
  });

  describe("validateTokens", () => {
    it("should return true for valid tokens", () => {
      const result = TokenManager.validateTokens(mockTokens);
      expect(result).toBe(true);
    });

    it("should return false for expired tokens", () => {
      const expiredTokens = {
        ...mockTokens,
        expiresAt: Date.now() - 1000, // 1 second ago
      };

      const result = TokenManager.validateTokens(expiredTokens);
      expect(result).toBe(false);
    });

    it("should return false for tokens expiring within buffer time", () => {
      const soonToExpireTokens = {
        ...mockTokens,
        expiresAt: Date.now() + 60000, // 1 minute from now (within 5-minute buffer)
      };

      const result = TokenManager.validateTokens(soonToExpireTokens);
      expect(result).toBe(false);
    });

    it("should return false for null or incomplete tokens", () => {
      expect(TokenManager.validateTokens(null as any)).toBe(false);
      expect(TokenManager.validateTokens({} as TokenSet)).toBe(false);
      expect(
        TokenManager.validateTokens({
          accessToken: "token",
        } as TokenSet)
      ).toBe(false);
    });
  });

  describe("needsRefresh", () => {
    it("should return true when tokens need refresh", () => {
      const tokensNeedingRefresh = {
        ...mockTokens,
        expiresAt: Date.now() + 300000, // 5 minutes from now (within 10-minute buffer)
      };

      const result = TokenManager.needsRefresh(tokensNeedingRefresh);
      expect(result).toBe(true);
    });

    it("should return false when tokens do not need refresh", () => {
      const result = TokenManager.needsRefresh(mockTokens);
      expect(result).toBe(false);
    });

    it("should return false for null tokens", () => {
      const result = TokenManager.needsRefresh(null as any);
      expect(result).toBe(false);
    });
  });

  describe("refreshTokens", () => {
    const mockTokenResponse = {
      access_token: "new-access-token",
      id_token: "new-id-token",
      refresh_token: "new-refresh-token",
      token_type: "Bearer" as const,
      expires_in: 3600,
    };

    beforeEach(() => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
    });

    it("should refresh tokens successfully", async () => {
      const result = await TokenManager.refreshTokens("refresh-token-123");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://test-domain.auth.us-east-1.amazoncognito.com/oauth2/token",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: expect.stringContaining("grant_type=refresh_token"),
        })
      );

      expect(result).toEqual({
        accessToken: mockTokenResponse.access_token,
        idToken: mockTokenResponse.id_token,
        refreshToken: mockTokenResponse.refresh_token,
        expiresAt: expect.any(Number),
      });
    });

    it("should handle refresh failure", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Refresh token expired",
          }),
      });

      await expect(
        TokenManager.refreshTokens("invalid-refresh-token")
      ).rejects.toMatchObject({
        type: AuthErrorType.REFRESH_FAILED,
        message: "Refresh token expired",
      });
    });

    it("should handle network errors", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Network error"));

      await expect(
        TokenManager.refreshTokens("refresh-token")
      ).rejects.toMatchObject({
        type: AuthErrorType.NETWORK_ERROR,
        message: "Network error during token refresh",
      });
    });
  });

  describe("getAccessToken", () => {
    it("should return access token for valid tokens", () => {
      // Mock retrieveTokens and validateTokens
      vi.spyOn(TokenManager, "retrieveTokens").mockReturnValue(mockTokens);
      vi.spyOn(TokenManager, "validateTokens").mockReturnValue(true);

      const result = TokenManager.getAccessToken();
      expect(result).toBe(mockTokens.accessToken);
    });

    it("should return null for invalid tokens", () => {
      vi.spyOn(TokenManager, "retrieveTokens").mockReturnValue(mockTokens);
      vi.spyOn(TokenManager, "validateTokens").mockReturnValue(false);

      const result = TokenManager.getAccessToken();
      expect(result).toBeNull();
    });

    it("should return null when no tokens exist", () => {
      vi.spyOn(TokenManager, "retrieveTokens").mockReturnValue(null);

      const result = TokenManager.getAccessToken();
      expect(result).toBeNull();
    });
  });
});

describe("UserManager", () => {
  const mockUser: User = {
    id: "user-123",
    email: "test@example.com",
    username: "testuser",
    hasPreferences: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, "cookie", {
      writable: true,
      value: "",
    });
  });

  describe("storeUser", () => {
    it("should store user in localStorage and cookies", () => {
      UserManager.storeUser(mockUser);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        "griot_user",
        expect.any(String)
      );
      expect(document.cookie).toContain("griot_user=");
    });
  });

  describe("retrieveUser", () => {
    it("should retrieve valid user data", () => {
      const userData = JSON.stringify(mockUser);
      (localStorage.getItem as any).mockReturnValue(btoa(userData));

      const result = UserManager.retrieveUser();
      expect(result).toEqual(mockUser);
    });

    it("should return null when no user data exists", () => {
      (localStorage.getItem as any).mockReturnValue(null);

      const result = UserManager.retrieveUser();
      expect(result).toBeNull();
    });

    it("should clear user data and return null for invalid data", () => {
      (localStorage.getItem as any).mockReturnValue("invalid-data");

      const result = UserManager.retrieveUser();
      expect(result).toBeNull();
      expect(localStorage.removeItem).toHaveBeenCalledWith("griot_user");
    });
  });

  describe("extractUserFromIdToken", () => {
    it("should extract user from valid ID token", () => {
      // Create a mock JWT payload
      const payload = {
        sub: "user-123",
        email: "test@example.com",
        "cognito:username": "testuser",
      };
      const encodedPayload = btoa(JSON.stringify(payload));
      const mockIdToken = `header.${encodedPayload}.signature`;

      const result = UserManager.extractUserFromIdToken(mockIdToken);
      expect(result).toEqual({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: false,
      });
    });

    it("should handle invalid ID token", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = UserManager.extractUserFromIdToken("invalid-token");
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

describe("CognitoOAuth", () => {
  const mockConfig: CognitoConfig = {
    userPoolId: "us-east-1_test123",
    clientId: "test-client-id",
    domain: "test-domain.auth.us-east-1.amazoncognito.com",
    redirectUri: "http://localhost:3000/callback",
    logoutUri: "http://localhost:3000",
    scopes: ["openid", "email", "profile"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateLoginUrl", () => {
    it("should generate valid login URL", () => {
      const url = CognitoOAuth.generateLoginUrl(mockConfig);

      expect(url).toContain(
        "https://test-domain.auth.us-east-1.amazoncognito.com/login"
      );
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain(
        "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback"
      );
      expect(url).toContain("scope=openid+email+profile");
      expect(url).toContain("state=");
    });

    it("should handle domain with protocol", () => {
      const configWithProtocol = {
        ...mockConfig,
        domain: "https://test-domain.auth.us-east-1.amazoncognito.com",
      };

      const url = CognitoOAuth.generateLoginUrl(configWithProtocol);
      expect(url).toContain(
        "https://test-domain.auth.us-east-1.amazoncognito.com/login"
      );
    });
  });

  describe("generateSignupUrl", () => {
    it("should generate valid signup URL", () => {
      const url = CognitoOAuth.generateSignupUrl(mockConfig);

      expect(url).toContain(
        "https://test-domain.auth.us-east-1.amazoncognito.com/signup"
      );
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=test-client-id");
    });
  });

  describe("generateLogoutUrl", () => {
    it("should generate valid logout URL", () => {
      const url = CognitoOAuth.generateLogoutUrl(mockConfig);

      expect(url).toContain(
        "https://test-domain.auth.us-east-1.amazoncognito.com/logout"
      );
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain("logout_uri=http%3A%2F%2Flocalhost%3A3000");
    });
  });

  describe("validateState", () => {
    it("should validate correct state parameter", () => {
      // Mock stored state
      vi.spyOn(SecureStorage, "getItem").mockReturnValue("test-state-123");
      vi.spyOn(SecureStorage, "removeItem").mockImplementation(() => {});

      const result = CognitoOAuth.validateState("test-state-123");
      expect(result).toBe(true);
      expect(SecureStorage.removeItem).toHaveBeenCalledWith("oauth_state");
    });

    it("should reject incorrect state parameter", () => {
      vi.spyOn(SecureStorage, "getItem").mockReturnValue("stored-state");
      vi.spyOn(SecureStorage, "removeItem").mockImplementation(() => {});

      const result = CognitoOAuth.validateState("different-state");
      expect(result).toBe(false);
    });

    it("should reject when no stored state exists", () => {
      vi.spyOn(SecureStorage, "getItem").mockReturnValue(null);
      vi.spyOn(SecureStorage, "removeItem").mockImplementation(() => {});

      const result = CognitoOAuth.validateState("any-state");
      expect(result).toBe(false);
    });
  });

  describe("exchangeCodeForTokens", () => {
    const mockTokenResponse = {
      access_token: "access-token-123",
      id_token: "id-token-123",
      refresh_token: "refresh-token-123",
      token_type: "Bearer" as const,
      expires_in: 3600,
    };

    beforeEach(() => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });
    });

    it("should exchange authorization code for tokens", async () => {
      const result = await CognitoOAuth.exchangeCodeForTokens(
        "auth-code-123",
        mockConfig
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "https://test-domain.auth.us-east-1.amazoncognito.com/oauth2/token",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: expect.stringContaining("grant_type=authorization_code"),
        })
      );

      expect(result).toEqual({
        accessToken: mockTokenResponse.access_token,
        idToken: mockTokenResponse.id_token,
        refreshToken: mockTokenResponse.refresh_token,
        expiresAt: expect.any(Number),
      });
    });

    it("should handle exchange failure", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Invalid authorization code",
          }),
      });

      await expect(
        CognitoOAuth.exchangeCodeForTokens("invalid-code", mockConfig)
      ).rejects.toMatchObject({
        type: AuthErrorType.COGNITO_ERROR,
        message: "Invalid authorization code",
      });
    });
  });

  describe("validateCallbackParams", () => {
    it("should validate successful callback parameters", () => {
      vi.spyOn(CognitoOAuth, "validateState").mockReturnValue(true);

      const searchParams = new URLSearchParams({
        code: "auth-code-123",
        state: "valid-state",
      });

      const result = CognitoOAuth.validateCallbackParams(searchParams);
      expect(result).toEqual({
        isValid: true,
        code: "auth-code-123",
        state: "valid-state",
      });
    });

    it("should handle OAuth error in callback", () => {
      const searchParams = new URLSearchParams({
        error: "access_denied",
        error_description: "User denied access",
      });

      const result = CognitoOAuth.validateCallbackParams(searchParams);
      expect(result).toEqual({
        isValid: false,
        error: "access_denied",
        errorDescription: "User denied access",
      });
    });

    it("should handle missing parameters", () => {
      const searchParams = new URLSearchParams({
        code: "auth-code-123",
        // missing state
      });

      const result = CognitoOAuth.validateCallbackParams(searchParams);
      expect(result).toEqual({
        isValid: false,
        error: "missing_parameters",
        errorDescription: "Missing required OAuth parameters",
      });
    });

    it("should handle invalid state parameter", () => {
      vi.spyOn(CognitoOAuth, "validateState").mockReturnValue(false);

      const searchParams = new URLSearchParams({
        code: "auth-code-123",
        state: "invalid-state",
      });

      const result = CognitoOAuth.validateCallbackParams(searchParams);
      expect(result).toEqual({
        isValid: false,
        error: "invalid_state",
        errorDescription: "Invalid state parameter - possible CSRF attack",
      });
    });
  });
});

describe("AuthUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location.href
    Object.defineProperty(window, "location", {
      value: {
        href: "",
        assign: vi.fn(),
        replace: vi.fn(),
        reload: vi.fn(),
      },
      writable: true,
    });
  });

  describe("login", () => {
    it("should redirect to Cognito login URL", () => {
      AuthUtils.login();
      expect(window.location.href).toContain("/login");
    });
  });

  describe("signup", () => {
    it("should redirect to Cognito signup URL", () => {
      AuthUtils.signup();
      expect(window.location.href).toContain("/signup");
    });
  });

  describe("logout", () => {
    it("should clear tokens and redirect to logout URL", () => {
      vi.spyOn(TokenManager, "clearTokens").mockImplementation(() => {});
      vi.spyOn(UserManager, "clearUser").mockImplementation(() => {});
      vi.spyOn(SecureStorage, "clear").mockImplementation(() => {});

      AuthUtils.logout();

      expect(TokenManager.clearTokens).toHaveBeenCalled();
      expect(UserManager.clearUser).toHaveBeenCalled();
      expect(SecureStorage.clear).toHaveBeenCalled();
      expect(window.location.href).toContain("/logout");
    });
  });

  describe("isAuthenticated", () => {
    it("should return true for valid tokens", () => {
      vi.spyOn(TokenManager, "retrieveTokens").mockReturnValue({
        accessToken: "token",
        idToken: "token",
        refreshToken: "token",
        expiresAt: Date.now() + 3600000,
      });
      vi.spyOn(TokenManager, "validateTokens").mockReturnValue(true);

      const result = AuthUtils.isAuthenticated();
      expect(result).toBe(true);
    });

    it("should return false for invalid tokens", () => {
      vi.spyOn(TokenManager, "retrieveTokens").mockReturnValue(null);

      const result = AuthUtils.isAuthenticated();
      expect(result).toBe(false);
    });
  });

  describe("getCurrentUser", () => {
    const mockUser: User = {
      id: "user-123",
      email: "test@example.com",
      username: "testuser",
      hasPreferences: false,
    };

    it("should return user when authenticated", () => {
      vi.spyOn(AuthUtils, "isAuthenticated").mockReturnValue(true);
      vi.spyOn(UserManager, "retrieveUser").mockReturnValue(mockUser);

      const result = AuthUtils.getCurrentUser();
      expect(result).toEqual(mockUser);
    });

    it("should return null when not authenticated", () => {
      vi.spyOn(AuthUtils, "isAuthenticated").mockReturnValue(false);

      const result = AuthUtils.getCurrentUser();
      expect(result).toBeNull();
    });
  });

  describe("handleCallback", () => {
    it("should handle successful callback", async () => {
      const mockUser: User = {
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: false,
      };

      vi.spyOn(CognitoOAuth, "validateCallbackParams").mockReturnValue({
        isValid: true,
        code: "auth-code-123",
        state: "valid-state",
      });
      vi.spyOn(CognitoOAuth, "exchangeCodeForTokens").mockResolvedValue({
        accessToken: "access-token",
        idToken: "id-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() + 3600000,
      });
      vi.spyOn(TokenManager, "storeTokens").mockImplementation(() => {});
      vi.spyOn(UserManager, "extractUserFromIdToken").mockReturnValue(mockUser);
      vi.spyOn(UserManager, "storeUser").mockImplementation(() => {});

      const searchParams = new URLSearchParams({
        code: "auth-code-123",
        state: "valid-state",
      });

      const result = await AuthUtils.handleCallback(searchParams);
      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockUser);
    });

    it("should handle callback validation failure", async () => {
      vi.spyOn(CognitoOAuth, "validateCallbackParams").mockReturnValue({
        isValid: false,
        error: "invalid_state",
        errorDescription: "Invalid state parameter",
      });

      const searchParams = new URLSearchParams({
        code: "auth-code-123",
        state: "invalid-state",
      });

      const result = await AuthUtils.handleCallback(searchParams);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe(AuthErrorType.VALIDATION_ERROR);
    });
  });

  describe("refreshTokensIfNeeded", () => {
    const mockTokens: TokenSet = {
      accessToken: "access-token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 300000, // 5 minutes from now
    };

    it("should refresh tokens when needed", async () => {
      vi.spyOn(TokenManager, "retrieveTokens").mockReturnValue(mockTokens);
      vi.spyOn(TokenManager, "needsRefresh").mockReturnValue(true);
      vi.spyOn(TokenManager, "refreshTokens").mockResolvedValue({
        ...mockTokens,
        expiresAt: Date.now() + 3600000,
      });
      vi.spyOn(UserManager, "extractUserFromIdToken").mockReturnValue({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: false,
      });
      vi.spyOn(UserManager, "storeUser").mockImplementation(() => {});

      const result = await AuthUtils.refreshTokensIfNeeded();
      expect(result).toBe(true);
      expect(TokenManager.refreshTokens).toHaveBeenCalled();
    });

    it("should return true when tokens do not need refresh", async () => {
      vi.spyOn(TokenManager, "retrieveTokens").mockReturnValue(mockTokens);
      vi.spyOn(TokenManager, "needsRefresh").mockReturnValue(false);

      const result = await AuthUtils.refreshTokensIfNeeded();
      expect(result).toBe(true);
    });

    it("should handle refresh failure", async () => {
      vi.spyOn(TokenManager, "retrieveTokens").mockReturnValue(mockTokens);
      vi.spyOn(TokenManager, "needsRefresh").mockReturnValue(true);
      vi.spyOn(TokenManager, "refreshTokens").mockRejectedValue(
        new Error("Refresh failed")
      );
      vi.spyOn(TokenManager, "clearTokens").mockImplementation(() => {});
      vi.spyOn(UserManager, "clearUser").mockImplementation(() => {});

      const result = await AuthUtils.refreshTokensIfNeeded();
      expect(result).toBe(false);
      expect(TokenManager.clearTokens).toHaveBeenCalled();
      expect(UserManager.clearUser).toHaveBeenCalled();
    });
  });
});
