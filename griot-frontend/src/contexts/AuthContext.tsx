"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import {
  AuthState,
  AuthContextType,
  ExtendedAuthContextType,
  User,
  TokenSet,
  AuthError,
  AuthErrorType,
} from "@/types/auth";
import { AuthUtils, TokenManager, UserManager } from "@/lib/auth";
import { setUserId, reportCustomEvent } from "@/lib/monitoring";

// Authentication state actions
type AuthAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_AUTHENTICATED"; payload: { user: User; tokens: TokenSet } }
  | { type: "SET_UNAUTHENTICATED" }
  | { type: "SET_ERROR"; payload: string }
  | { type: "CLEAR_ERROR" }
  | { type: "UPDATE_USER"; payload: User };

// Initial authentication state
const initialState: AuthState = {
  status: "loading",
  user: null,
  tokens: null,
  error: null,
};

// Authentication state reducer
function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "SET_LOADING":
      return {
        ...state,
        status: action.payload ? "loading" : state.status,
        error: action.payload ? null : state.error,
      };

    case "SET_AUTHENTICATED":
      // Set user ID for monitoring
      setUserId(action.payload.user.id);

      // Report authentication event
      reportCustomEvent("user_authenticated", {
        userId: action.payload.user.id,
        email: action.payload.user.email,
        hasPreferences: action.payload.user.hasPreferences,
      });

      return {
        status: "authenticated",
        user: action.payload.user,
        tokens: action.payload.tokens,
        error: null,
      };

    case "SET_UNAUTHENTICATED":
      // Report logout event if there was a previous user
      if (state.user) {
        reportCustomEvent("user_logged_out", {
          userId: state.user.id,
          email: state.user.email,
        });
      }

      return {
        status: "unauthenticated",
        user: null,
        tokens: null,
        error: null,
      };

    case "SET_ERROR":
      return {
        ...state,
        status: "unauthenticated",
        error: action.payload,
      };

    case "CLEAR_ERROR":
      return {
        ...state,
        error: null,
      };

    case "UPDATE_USER":
      return {
        ...state,
        user: action.payload,
      };

    default:
      return state;
  }
}

// Create the authentication context
const AuthContext = createContext<ExtendedAuthContextType | undefined>(
  undefined
);

// Authentication provider props
interface AuthProviderProps {
  children: ReactNode;
}

// Authentication provider component
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Token refresh with automatic retry
  const refreshTokens = useCallback(async (): Promise<boolean> => {
    try {
      const success = await AuthUtils.refreshTokensIfNeeded();

      if (success) {
        // Get updated tokens and user
        const tokens = TokenManager.retrieveTokens();
        const user = UserManager.retrieveUser();

        if (tokens && user) {
          dispatch({
            type: "SET_AUTHENTICATED",
            payload: { user, tokens },
          });
          return true;
        }
      }

      // If refresh failed, set unauthenticated
      dispatch({ type: "SET_UNAUTHENTICATED" });
      return false;
    } catch (error) {
      console.error("Token refresh failed:", error);
      dispatch({ type: "SET_UNAUTHENTICATED" });
      return false;
    }
  }, []);

  // Check if user has valid tokens
  const hasValidTokens = useCallback((): boolean => {
    const tokens = TokenManager.retrieveTokens();
    return tokens !== null && TokenManager.validateTokens(tokens);
  }, []);

  // Login function
  const login = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
    AuthUtils.login();
  }, []);

  // Logout function
  const logout = useCallback(() => {
    dispatch({ type: "SET_UNAUTHENTICATED" });
    AuthUtils.logout();
  }, []);

  // Update user information
  const updateUser = useCallback((user: User) => {
    UserManager.storeUser(user);
    dispatch({ type: "UPDATE_USER", payload: user });
  }, []);

  // Initialize authentication state on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        dispatch({ type: "SET_LOADING", payload: true });

        // Check if user is authenticated
        if (AuthUtils.isAuthenticated()) {
          const tokens = TokenManager.retrieveTokens();
          const user = UserManager.retrieveUser();

          if (tokens && user) {
            // Check if tokens need refresh
            if (TokenManager.needsRefresh(tokens)) {
              const refreshSuccess = await refreshTokens();
              if (!refreshSuccess) {
                dispatch({ type: "SET_UNAUTHENTICATED" });
                return;
              }
            } else {
              dispatch({
                type: "SET_AUTHENTICATED",
                payload: { user, tokens },
              });
            }
          } else {
            dispatch({ type: "SET_UNAUTHENTICATED" });
          }
        } else {
          dispatch({ type: "SET_UNAUTHENTICATED" });
        }
      } catch (error) {
        console.error("Auth initialization failed:", error);
        dispatch({
          type: "SET_ERROR",
          payload: "Failed to initialize authentication",
        });
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    };

    initializeAuth();
  }, [refreshTokens]);

  // Set up automatic token refresh
  useEffect(() => {
    if (state.status !== "authenticated" || !state.tokens) {
      return;
    }

    // Calculate time until token refresh is needed
    const now = Date.now();
    const refreshBuffer = 10 * 60 * 1000; // 10 minutes
    const timeUntilRefresh = state.tokens.expiresAt - now - refreshBuffer;

    // If tokens need immediate refresh
    if (timeUntilRefresh <= 0) {
      refreshTokens();
      return;
    }

    // Set up automatic refresh timer
    const refreshTimer = setTimeout(() => {
      refreshTokens();
    }, timeUntilRefresh);

    return () => {
      clearTimeout(refreshTimer);
    };
  }, [state.status, state.tokens, refreshTokens]);

  // Handle OAuth callback
  const handleCallback = useCallback(async (searchParams: URLSearchParams) => {
    try {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "CLEAR_ERROR" });

      const result = await AuthUtils.handleCallback(searchParams);

      if (result.success && result.user) {
        const tokens = TokenManager.retrieveTokens();
        if (tokens) {
          dispatch({
            type: "SET_AUTHENTICATED",
            payload: { user: result.user, tokens },
          });
        } else {
          throw new Error("Tokens not found after successful callback");
        }
      } else if (result.error) {
        dispatch({
          type: "SET_ERROR",
          payload: result.error.message,
        });
      }
    } catch (error) {
      console.error("Callback handling failed:", error);
      dispatch({
        type: "SET_ERROR",
        payload: "Authentication failed. Please try again.",
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, []);

  // Context value
  const contextValue: AuthContextType = {
    user: state.user,
    isAuthenticated: state.status === "authenticated",
    isLoading: state.status === "loading",
    login,
    logout,
    refreshTokens,
    hasValidTokens,
  };

  // Add additional methods for internal use
  const extendedContextValue = {
    ...contextValue,
    updateUser,
    handleCallback,
    error: state.error,
    clearError: () => dispatch({ type: "CLEAR_ERROR" }),
  };

  return (
    <AuthContext.Provider value={extendedContextValue}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook to use authentication context
export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}

// Export the context for advanced usage
export { AuthContext };
