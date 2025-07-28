"use client";

import { useAuthContext } from "@/contexts/AuthContext";
import { AuthContextType } from "@/types/auth";

/**
 * Custom hook for component-level authentication access
 *
 * This hook provides a clean interface for components to access
 * authentication state and methods without directly using the context.
 *
 * @returns AuthContextType - Authentication state and methods
 */
export function useAuth(): AuthContextType {
  const context = useAuthContext();

  // Return only the public interface, hiding internal methods
  return {
    user: context.user,
    isAuthenticated: context.isAuthenticated,
    isLoading: context.isLoading,
    login: context.login,
    logout: context.logout,
    refreshTokens: context.refreshTokens,
    hasValidTokens: context.hasValidTokens,
  };
}

/**
 * Hook for accessing extended authentication context (internal use)
 *
 * This hook provides access to additional methods like updateUser,
 * handleCallback, error handling, etc. Should only be used internally
 * by authentication-related components.
 */
export function useAuthInternal() {
  return useAuthContext();
}
