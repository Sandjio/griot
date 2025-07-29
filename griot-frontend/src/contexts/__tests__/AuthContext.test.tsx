import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { AuthProvider, useAuthContext } from "../AuthContext";
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

// Test component that uses the auth context
function TestComponent() {
  const {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    refreshTokens,
    hasValidTokens,
    updateUser,
    handleCallback,
    error,
    clearError,
  } = useAuthContext();

  return (
    <div>
      <div data-testid="loading">{isLoading.toString()}</div>
      <div data-testid="authenticated">{isAuthenticated.toString()}</div>
      <div data-testid="user">{user ? JSON.stringify(user) : "null"}</div>
      <div data-testid="error">{error || "null"}</div>
      <button onClick={login} data-testid="login-btn">
        Login
      </button>
      <button onClick={logout} data-testid="logout-btn">
        Logout
      </button>
      <button onClick={() => refreshTokens()} data-testid="refresh-btn">
        Refresh
      </button>
      <button onClick={() => hasValidTokens()} data-testid="validate-btn">
        Validate
      </button>
      <button onClick={clearError} data-testid="clear-error-btn">
        Clear Error
      </button>
      <button
        onClick={() =>
          updateUser({
            id: "updated-user",
            email: "updated@example.com",
            username: "updated",
            hasPreferences: true,
          })
        }
        data-testid="update-user-btn"
      >
        Update User
      </button>
      <button
        onClick={() =>
          handleCallback(new URLSearchParams("code=123&state=abc"))
        }
        data-testid="handle-callback-btn"
      >
        Handle Callback
      </button>
    </div>
  );
}

describe("AuthContext", () => {
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

  describe("initialization", () => {
    it("should start in loading state", () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      expect(screen.getByTestId("loading")).toHaveTextContent("true");
      expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
      expect(screen.getByTestId("user")).toHaveTextContent("null");
    });

    it("should initialize with authenticated user", async () => {
      (AuthUtils.isAuthenticated as any).mockReturnValue(true);
      (TokenManager.retrieveTokens as any).mockReturnValue(mockTokens);
      (TokenManager.needsRefresh as any).mockReturnValue(false);
      (UserManager.retrieveUser as any).mockReturnValue(mockUser);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
      expect(screen.getByTestId("user")).toHaveTextContent(
        JSON.stringify(mockUser)
      );
    });

    it("should refresh tokens on initialization if needed", async () => {
      (AuthUtils.isAuthenticated as any).mockReturnValue(true);
      (TokenManager.retrieveTokens as any).mockReturnValue(mockTokens);
      (TokenManager.needsRefresh as any).mockReturnValue(true);
      (AuthUtils.refreshTokensIfNeeded as any).mockResolvedValue(true);
      (UserManager.retrieveUser as any).mockReturnValue(mockUser);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(AuthUtils.refreshTokensIfNeeded).toHaveBeenCalled();
      });
    });

    it("should handle initialization failure", async () => {
      (AuthUtils.isAuthenticated as any).mockImplementation(() => {
        throw new Error("Initialization error");
      });

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      expect(screen.getByTestId("error")).toHaveTextContent(
        "Failed to initialize authentication"
      );
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("login", () => {
    it("should call AuthUtils.login and clear errors", async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      act(() => {
        screen.getByTestId("login-btn").click();
      });

      expect(AuthUtils.login).toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("should call AuthUtils.logout and set unauthenticated state", async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      act(() => {
        screen.getByTestId("logout-btn").click();
      });

      expect(AuthUtils.logout).toHaveBeenCalled();
      expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
      expect(screen.getByTestId("user")).toHaveTextContent("null");
    });
  });

  describe("refreshTokens", () => {
    it("should refresh tokens successfully", async () => {
      (AuthUtils.refreshTokensIfNeeded as any).mockResolvedValue(true);
      (TokenManager.retrieveTokens as any).mockReturnValue(mockTokens);
      (UserManager.retrieveUser as any).mockReturnValue(mockUser);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      await act(async () => {
        screen.getByTestId("refresh-btn").click();
      });

      expect(AuthUtils.refreshTokensIfNeeded).toHaveBeenCalled();
    });

    it("should handle refresh failure", async () => {
      (AuthUtils.refreshTokensIfNeeded as any).mockResolvedValue(false);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      await act(async () => {
        screen.getByTestId("refresh-btn").click();
      });

      expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    });

    it("should handle refresh error", async () => {
      (AuthUtils.refreshTokensIfNeeded as any).mockRejectedValue(
        new Error("Refresh error")
      );

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      await act(async () => {
        screen.getByTestId("refresh-btn").click();
      });

      expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("hasValidTokens", () => {
    it("should return true for valid tokens", async () => {
      (TokenManager.retrieveTokens as any).mockReturnValue(mockTokens);
      (TokenManager.validateTokens as any).mockReturnValue(true);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      act(() => {
        screen.getByTestId("validate-btn").click();
      });

      expect(TokenManager.retrieveTokens).toHaveBeenCalled();
      expect(TokenManager.validateTokens).toHaveBeenCalledWith(mockTokens);
    });
  });

  describe("updateUser", () => {
    it("should update user and store in UserManager", async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      const updatedUser = {
        id: "updated-user",
        email: "updated@example.com",
        username: "updated",
        hasPreferences: true,
      };

      act(() => {
        screen.getByTestId("update-user-btn").click();
      });

      expect(UserManager.storeUser).toHaveBeenCalledWith(updatedUser);
      expect(screen.getByTestId("user")).toHaveTextContent(
        JSON.stringify(updatedUser)
      );
    });
  });

  describe("handleCallback", () => {
    it("should handle successful callback", async () => {
      (AuthUtils.handleCallback as any).mockResolvedValue({
        success: true,
        user: mockUser,
      });
      (TokenManager.retrieveTokens as any).mockReturnValue(mockTokens);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      await act(async () => {
        screen.getByTestId("handle-callback-btn").click();
      });

      expect(AuthUtils.handleCallback).toHaveBeenCalled();
      expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
      expect(screen.getByTestId("user")).toHaveTextContent(
        JSON.stringify(mockUser)
      );
    });

    it("should handle callback failure", async () => {
      (AuthUtils.handleCallback as any).mockResolvedValue({
        success: false,
        error: {
          type: "COGNITO_ERROR",
          message: "Authentication failed",
        },
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      await act(async () => {
        screen.getByTestId("handle-callback-btn").click();
      });

      expect(screen.getByTestId("error")).toHaveTextContent(
        "Authentication failed"
      );
    });

    it("should handle callback exception", async () => {
      (AuthUtils.handleCallback as any).mockRejectedValue(
        new Error("Callback error")
      );

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      await act(async () => {
        screen.getByTestId("handle-callback-btn").click();
      });

      expect(screen.getByTestId("error")).toHaveTextContent(
        "Authentication failed. Please try again."
      );
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("clearError", () => {
    it("should clear error state", async () => {
      // First set an error state
      (AuthUtils.handleCallback as any).mockResolvedValue({
        success: false,
        error: {
          type: "COGNITO_ERROR",
          message: "Test error",
        },
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });

      // Trigger error
      await act(async () => {
        screen.getByTestId("handle-callback-btn").click();
      });

      expect(screen.getByTestId("error")).toHaveTextContent("Test error");

      // Clear error
      act(() => {
        screen.getByTestId("clear-error-btn").click();
      });

      expect(screen.getByTestId("error")).toHaveTextContent("null");
    });
  });

  describe("automatic token refresh", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should set up automatic refresh timer for authenticated users", async () => {
      const futureExpiry = Date.now() + 20 * 60 * 1000; // 20 minutes from now
      const tokensWithFutureExpiry = {
        ...mockTokens,
        expiresAt: futureExpiry,
      };

      (AuthUtils.isAuthenticated as any).mockReturnValue(true);
      (TokenManager.retrieveTokens as any).mockReturnValue(
        tokensWithFutureExpiry
      );
      (TokenManager.needsRefresh as any).mockReturnValue(false);
      (UserManager.retrieveUser as any).mockReturnValue(mockUser);
      (AuthUtils.refreshTokensIfNeeded as any).mockResolvedValue(true);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
      });

      // Fast forward to when refresh should happen (10 minutes before expiry)
      const refreshTime = futureExpiry - Date.now() - 10 * 60 * 1000;
      act(() => {
        vi.advanceTimersByTime(refreshTime);
      });

      await waitFor(() => {
        expect(AuthUtils.refreshTokensIfNeeded).toHaveBeenCalled();
      });
    });

    it("should refresh immediately if tokens need immediate refresh", async () => {
      const soonToExpireTokens = {
        ...mockTokens,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes from now
      };

      (AuthUtils.isAuthenticated as any).mockReturnValue(true);
      (TokenManager.retrieveTokens as any).mockReturnValue(soonToExpireTokens);
      (TokenManager.needsRefresh as any).mockReturnValue(false);
      (UserManager.retrieveUser as any).mockReturnValue(mockUser);
      (AuthUtils.refreshTokensIfNeeded as any).mockResolvedValue(true);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
      });

      // Should refresh immediately since tokens expire within 10 minutes
      expect(AuthUtils.refreshTokensIfNeeded).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should throw error when used outside provider", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useAuthContext must be used within an AuthProvider");

      consoleSpy.mockRestore();
    });
  });
});
