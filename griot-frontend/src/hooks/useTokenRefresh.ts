"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { TokenManager } from "@/lib/auth";

/**
 * Custom hook for automatic token management
 *
 * This hook handles automatic token refresh with configurable intervals
 * and provides manual refresh capabilities.
 */
export function useTokenRefresh() {
  const { isAuthenticated, refreshTokens, hasValidTokens } = useAuth();
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRefreshingRef = useRef(false);

  /**
   * Manual token refresh with debouncing
   */
  const manualRefresh = useCallback(async (): Promise<boolean> => {
    if (isRefreshingRef.current) {
      return false;
    }

    try {
      isRefreshingRef.current = true;
      const success = await refreshTokens();
      return success;
    } catch (error) {
      console.error("Manual token refresh failed:", error);
      return false;
    } finally {
      isRefreshingRef.current = false;
    }
  }, [refreshTokens]);

  /**
   * Check if tokens need refresh soon
   */
  const needsRefreshSoon = useCallback((): boolean => {
    if (!isAuthenticated) return false;

    const tokens = TokenManager.retrieveTokens();
    if (!tokens) return false;

    // Check if tokens expire within 15 minutes
    const now = Date.now();
    const refreshBuffer = 15 * 60 * 1000; // 15 minutes

    return tokens.expiresAt <= now + refreshBuffer;
  }, [isAuthenticated]);

  /**
   * Get time until next refresh is needed (in milliseconds)
   */
  const getTimeUntilRefresh = useCallback((): number => {
    if (!isAuthenticated) return -1;

    const tokens = TokenManager.retrieveTokens();
    if (!tokens) return -1;

    const now = Date.now();
    const refreshBuffer = 10 * 60 * 1000; // 10 minutes before expiry

    return Math.max(0, tokens.expiresAt - now - refreshBuffer);
  }, [isAuthenticated]);

  /**
   * Set up automatic refresh timer
   */
  const setupRefreshTimer = useCallback(() => {
    // Clear existing timer
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    if (!isAuthenticated || !hasValidTokens()) {
      return;
    }

    const timeUntilRefresh = getTimeUntilRefresh();

    if (timeUntilRefresh <= 0) {
      // Immediate refresh needed
      manualRefresh();
      return;
    }

    // Set up timer for automatic refresh
    refreshTimeoutRef.current = setTimeout(() => {
      manualRefresh().then((success) => {
        if (success) {
          // Set up next refresh timer
          setupRefreshTimer();
        }
      });
    }, timeUntilRefresh);
  }, [isAuthenticated, hasValidTokens, getTimeUntilRefresh, manualRefresh]);

  /**
   * Force immediate token refresh if needed
   */
  const refreshIfNeeded = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) return false;

    const tokens = TokenManager.retrieveTokens();
    if (!tokens) return false;

    // Check if refresh is actually needed
    if (TokenManager.needsRefresh(tokens)) {
      return await manualRefresh();
    }

    return true; // Tokens are still valid
  }, [isAuthenticated, manualRefresh]);

  // Set up automatic refresh when authentication state changes
  useEffect(() => {
    setupRefreshTimer();

    // Cleanup on unmount or when authentication changes
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [setupRefreshTimer]);

  // Handle page visibility changes to refresh tokens when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isAuthenticated) {
        // Check if tokens need refresh when page becomes visible
        refreshIfNeeded();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isAuthenticated, refreshIfNeeded]);

  return {
    /**
     * Manually trigger token refresh
     */
    refresh: manualRefresh,

    /**
     * Check if tokens need refresh soon
     */
    needsRefreshSoon,

    /**
     * Get time until next refresh (in milliseconds)
     */
    getTimeUntilRefresh,

    /**
     * Refresh tokens only if needed
     */
    refreshIfNeeded,

    /**
     * Whether a refresh is currently in progress
     */
    isRefreshing: isRefreshingRef.current,
  };
}
