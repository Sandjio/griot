import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import { useAuth, useAuthInternal } from "../useAuth";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthUtils, TokenManager, UserManager } from "@/lib/auth";
import { User, TokenSet } from "@/types/auth";

// Mock the auth utilities
vi.mock("@/lib/auth", () => ({
  AuthUtils: {
    isAuthenticated: vi.fn(),
    refreshTokensIfNeeded: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    handleCallback: vi.fn(),
  },
  TokenManager: {
    retrieveTokens: vi.fn(),
    validateTokens: vi.fn(),
    needsRefresh: vi.fn(),
  },
  UserManager: {
    retrieveUser: vi.fn(),
    storeUser: vi.fn(),
  },
}));

// Wrapper component for testing hooks
function AuthWrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("useAuth", () => {
  const mockUser: User = {
    id: "user-123",
    email: "test@example.com",
    username: "testuser",
    hasPreferences: false,
  };

  const mockTokens: TokenSet = {
    accessToken: "access-token",
    idToken: "id-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 3600000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all mocks to default values
    (AuthUtils.isAuthenticated as any).mockReturnValue(false);
    (AuthUtils.refreshTokensIfNeeded as any).mockResolvedValue(true);
    (TokenManager.retrieveTokens as any).mockReturnValue(null);
    (TokenManager.validateTokens as any).mockReturnValue(false);
    (TokenManager.needsRefresh as any).mockReturnValue(false);
    (UserManager.retrieveUser as any).mockReturnValue(null);
  });

  describe("basic functionality", () => {
    it("should return authentication state and methods", () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthWrapper,
      });

      expect(result.current).toHaveProperty("user");
      expect(result.current).toHaveProperty("isAuthenticated");
      expect(result.current).toHaveProperty("isLoading");
      expect(result.current).toHaveProperty("login");
      expect(result.current).toHaveProperty("logout");
      expect(result.current).toHaveProperty("refreshTokens");
      expect(result.current).toHaveProperty("hasValidTokens");

      // Should not expose internal methods
      expect(result.current).not.toHaveProperty("updateUser");
      expect(result.current).not.toHaveProperty("handleCallback");
      expect(result.current).not.toHaveProperty("error");
      expect(result.current).not.toHaveProperty("clearError");
    });

    it("should return initial unauthenticated state", () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthWrapper,
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(true); // Initially loading
    });

    it("should return authenticated state when user is logged in", async () => {
      (AuthUtils.isAuthenticated as any).mockReturnValue(true);
      (TokenManager.retrieveTokens as any).mockReturnValue(mockTokens);
      (TokenManager.needsRefresh as any).mockReturnValue(false);
      (UserManager.retrieveUser as any).mockReturnValue(mockUser);

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthWrapper,
      });

      // Wait for initialization to complete
      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  describe("authentication methods", () => {
    it("should call login method", () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthWrapper,
      });

      result.current.login();
      expect(AuthUtils.login).toHaveBeenCalled();
    });

    it("should call logout method", () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthWrapper,
      });

      result.current.logout();
      expect(AuthUtils.logout).toHaveBeenCalled();
    });

    it("should call refreshTokens method", async () => {
      (AuthUtils.refreshTokensIfNeeded as any).mockResolvedValue(true);

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthWrapper,
      });

      const refreshResult = await result.current.refreshTokens();
      expect(refreshResult).toBe(true);
      expect(AuthUtils.refreshTokensIfNeeded).toHaveBeenCalled();
    });

    it("should call hasValidTokens method", () => {
      (TokenManager.retrieveTokens as any).mockReturnValue(mockTokens);
      (TokenManager.validateTokens as any).mockReturnValue(true);

      const { result } = renderHook(() => useAuth(), {
        wrapper: AuthWrapper,
      });

      const isValid = result.current.hasValidTokens();
      expect(isValid).toBe(true);
      expect(TokenManager.retrieveTokens).toHaveBeenCalled();
      expect(TokenManager.validateTokens).toHaveBeenCalledWith(mockTokens);
    });
  });

  describe("error handling", () => {
    it("should throw error when used outside AuthProvider", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAuth());
      }).toThrow("useAuthContext must be used within an AuthProvider");

      consoleSpy.mockRestore();
    });
  });
});

describe("useAuthInternal", () => {
  const mockUser: User = {
    id: "user-123",
    email: "test@example.com",
    username: "testuser",
    hasPreferences: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (AuthUtils.isAuthenticated as any).mockReturnValue(false);
    (AuthUtils.refreshTokensIfNeeded as any).mockResolvedValue(true);
    (TokenManager.retrieveTokens as any).mockReturnValue(null);
    (TokenManager.validateTokens as any).mockReturnValue(false);
    (TokenManager.needsRefresh as any).mockReturnValue(false);
    (UserManager.retrieveUser as any).mockReturnValue(null);
  });

  describe("extended functionality", () => {
    it("should return all authentication context methods including internal ones", () => {
      const { result } = renderHook(() => useAuthInternal(), {
        wrapper: AuthWrapper,
      });

      // Should have all public methods
      expect(result.current).toHaveProperty("user");
      expect(result.current).toHaveProperty("isAuthenticated");
      expect(result.current).toHaveProperty("isLoading");
      expect(result.current).toHaveProperty("login");
      expect(result.current).toHaveProperty("logout");
      expect(result.current).toHaveProperty("refreshTokens");
      expect(result.current).toHaveProperty("hasValidTokens");

      // Should also have internal methods
      expect(result.current).toHaveProperty("updateUser");
      expect(result.current).toHaveProperty("handleCallback");
      expect(result.current).toHaveProperty("error");
      expect(result.current).toHaveProperty("clearError");
    });

    it("should allow updating user", async () => {
      const { result } = renderHook(() => useAuthInternal(), {
        wrapper: AuthWrapper,
      });

      // Wait for initialization
      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const updatedUser = {
        ...mockUser,
        hasPreferences: true,
      };

      result.current.updateUser(updatedUser);
      expect(UserManager.storeUser).toHaveBeenCalledWith(updatedUser);
    });

    it("should handle callback", async () => {
      (AuthUtils.handleCallback as any).mockResolvedValue({
        success: true,
        user: mockUser,
      });
      (TokenManager.retrieveTokens as any).mockReturnValue({
        accessToken: "token",
        idToken: "token",
        refreshToken: "token",
        expiresAt: Date.now() + 3600000,
      });

      const { result } = renderHook(() => useAuthInternal(), {
        wrapper: AuthWrapper,
      });

      // Wait for initialization
      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const searchParams = new URLSearchParams("code=123&state=abc");
      await result.current.handleCallback(searchParams);

      expect(AuthUtils.handleCallback).toHaveBeenCalledWith(searchParams);
    });

    it("should manage error state", async () => {
      (AuthUtils.handleCallback as any).mockResolvedValue({
        success: false,
        error: {
          type: "COGNITO_ERROR",
          message: "Test error",
        },
      });

      const { result } = renderHook(() => useAuthInternal(), {
        wrapper: AuthWrapper,
      });

      // Wait for initialization
      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Trigger error
      const searchParams = new URLSearchParams("error=access_denied");
      await result.current.handleCallback(searchParams);

      expect(result.current.error).toBe("Test error");

      // Clear error
      result.current.clearError();
      expect(result.current.error).toBeNull();
    });
  });

  describe("error handling", () => {
    it("should throw error when used outside AuthProvider", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAuthInternal());
      }).toThrow("useAuthContext must be used within an AuthProvider");

      consoleSpy.mockRestore();
    });
  });
});

describe("hook integration", () => {
  const mockUser: User = {
    id: "user-123",
    email: "test@example.com",
    username: "testuser",
    hasPreferences: false,
  };

  const mockTokens: TokenSet = {
    accessToken: "access-token",
    idToken: "id-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 3600000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should maintain consistent state between useAuth and useAuthInternal", async () => {
    (AuthUtils.isAuthenticated as any).mockReturnValue(true);
    (TokenManager.retrieveTokens as any).mockReturnValue(mockTokens);
    (TokenManager.needsRefresh as any).mockReturnValue(false);
    (UserManager.retrieveUser as any).mockReturnValue(mockUser);

    const { result: authResult } = renderHook(() => useAuth(), {
      wrapper: AuthWrapper,
    });

    const { result: internalResult } = renderHook(() => useAuthInternal(), {
      wrapper: AuthWrapper,
    });

    // Wait for initialization
    await vi.waitFor(() => {
      expect(authResult.current.isLoading).toBe(false);
      expect(internalResult.current.isLoading).toBe(false);
    });

    // Both hooks should have the same public state
    expect(authResult.current.user).toEqual(internalResult.current.user);
    expect(authResult.current.isAuthenticated).toBe(
      internalResult.current.isAuthenticated
    );
    expect(authResult.current.isLoading).toBe(internalResult.current.isLoading);
  });

  it("should reflect state changes across both hooks", async () => {
    const { result: authResult } = renderHook(() => useAuth(), {
      wrapper: AuthWrapper,
    });

    const { result: internalResult } = renderHook(() => useAuthInternal(), {
      wrapper: AuthWrapper,
    });

    // Wait for initialization
    await vi.waitFor(() => {
      expect(authResult.current.isLoading).toBe(false);
    });

    // Update user through internal hook
    const updatedUser = {
      ...mockUser,
      hasPreferences: true,
    };

    internalResult.current.updateUser(updatedUser);

    // Both hooks should reflect the change
    expect(authResult.current.user).toEqual(updatedUser);
    expect(internalResult.current.user).toEqual(updatedUser);
  });
});
