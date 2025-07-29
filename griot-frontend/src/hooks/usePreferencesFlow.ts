"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "./useAuth";
import { apiService } from "@/lib/api";

/**
 * Hook for managing the preferences flow routing logic
 *
 * This hook handles:
 * - Redirecting new users to preferences page
 * - Skipping preferences for returning users
 * - Navigation to dashboard after successful preferences submission
 */
export function usePreferencesFlow() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isRedirecting, setIsRedirecting] = useState(false);

  /**
   * Check if user needs to complete preferences
   */
  const needsPreferences = useCallback((): boolean => {
    return Boolean(isAuthenticated && user && !user.hasPreferences);
  }, [isAuthenticated, user]);

  /**
   * Check if current route is preferences-related
   */
  const isPreferencesRoute = useCallback((): boolean => {
    return pathname === "/preferences";
  }, [pathname]);

  /**
   * Check if current route is dashboard or other protected route
   */
  const isProtectedRoute = useCallback((): boolean => {
    const protectedPaths = ["/dashboard", "/profile", "/settings"];
    return protectedPaths.some((path) => pathname.startsWith(path));
  }, [pathname]);

  /**
   * Check if current route is callback page
   */
  const isCallbackRoute = useCallback((): boolean => {
    return pathname === "/callback";
  }, [pathname]);

  /**
   * Check if current route is landing page
   */
  const isLandingRoute = useCallback((): boolean => {
    return pathname === "/";
  }, [pathname]);

  /**
   * Redirect to preferences page
   */
  const redirectToPreferences = useCallback(() => {
    if (pathname !== "/preferences" && !isRedirecting) {
      setIsRedirecting(true);
      router.push("/preferences");
    }
  }, [router, pathname, isRedirecting]);

  /**
   * Redirect to dashboard
   */
  const redirectToDashboard = useCallback(() => {
    if (pathname !== "/dashboard" && !isRedirecting) {
      setIsRedirecting(true);
      router.push("/dashboard");
    }
  }, [router, pathname, isRedirecting]);

  /**
   * Determine the correct redirect destination for a user
   */
  const getRedirectDestination = useCallback((): string => {
    if (!isAuthenticated || !user) {
      return "/";
    }

    return user.hasPreferences ? "/dashboard" : "/preferences";
  }, [isAuthenticated, user]);

  /**
   * Handle preferences flow routing
   */
  const handlePreferencesFlow = useCallback(() => {
    // Don't redirect while loading or already redirecting
    if (isLoading || isRedirecting) {
      return;
    }

    // Only handle authenticated users
    if (!isAuthenticated || !user) {
      return;
    }

    // Case 1: User needs preferences but is not on preferences page
    if (needsPreferences() && !isPreferencesRoute()) {
      // Redirect from protected routes, callback, or landing page
      if (isProtectedRoute() || isCallbackRoute() || isLandingRoute()) {
        console.log("Redirecting new user to preferences page");
        redirectToPreferences();
        return;
      }
    }

    // Case 2: User has preferences but is on preferences page
    if (!needsPreferences() && isPreferencesRoute()) {
      console.log("Redirecting returning user to dashboard");
      redirectToDashboard();
      return;
    }

    // Case 3: User has preferences and is on landing page
    if (!needsPreferences() && isLandingRoute()) {
      console.log("Redirecting authenticated user to dashboard");
      redirectToDashboard();
      return;
    }
  }, [
    isLoading,
    isRedirecting,
    isAuthenticated,
    user,
    needsPreferences,
    isPreferencesRoute,
    isProtectedRoute,
    isCallbackRoute,
    isLandingRoute,
    redirectToPreferences,
    redirectToDashboard,
  ]);

  /**
   * Verify user preferences status with API
   * This ensures the local user state is in sync with the backend
   */
  const verifyPreferencesStatus = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated || !user) {
      return false;
    }

    try {
      const result = await apiService.get(
        "/preferences",
        "verify user preferences"
      );
      const hasPreferences = result.success && !!result.data;

      // If the API status differs from local state, this indicates a sync issue
      if (hasPreferences !== user.hasPreferences) {
        console.warn(
          `Preferences status mismatch: local=${user.hasPreferences}, api=${hasPreferences}`
        );
      }

      return hasPreferences;
    } catch (error) {
      console.warn("Failed to verify preferences status:", error);
      // Return local state as fallback
      return user.hasPreferences;
    }
  }, [isAuthenticated, user]);

  /**
   * Handle successful preferences submission
   * This should be called after preferences are successfully saved
   */
  const handlePreferencesSubmitted = useCallback(() => {
    console.log("Preferences submitted successfully, redirecting to dashboard");
    // Add a small delay to ensure the UI shows success state
    setTimeout(() => {
      redirectToDashboard();
    }, 500);
  }, [redirectToDashboard]);

  /**
   * Handle authentication completion (called from callback page)
   * This determines where to redirect based on user preferences status
   */
  const handleAuthenticationComplete = useCallback(
    (userWithPreferences: { hasPreferences: boolean }) => {
      const destination = userWithPreferences.hasPreferences
        ? "/dashboard"
        : "/preferences";
      console.log(`Authentication complete, redirecting to: ${destination}`);

      setIsRedirecting(true);
      // Add a small delay to show success message
      setTimeout(() => {
        router.replace(destination);
      }, 1500);
    },
    [router]
  );

  // Run preferences flow logic on mount and when dependencies change
  useEffect(() => {
    handlePreferencesFlow();
  }, [handlePreferencesFlow]);

  // Reset redirecting state when pathname changes
  useEffect(() => {
    setIsRedirecting(false);
  }, [pathname]);

  return {
    /**
     * Whether user needs to complete preferences
     */
    needsPreferences: needsPreferences(),

    /**
     * Whether current route is preferences page
     */
    isPreferencesRoute: isPreferencesRoute(),

    /**
     * Whether current route is a protected route
     */
    isProtectedRoute: isProtectedRoute(),

    /**
     * Whether currently redirecting
     */
    isRedirecting,

    /**
     * Get the correct redirect destination for current user
     */
    getRedirectDestination,

    /**
     * Manual redirect functions
     */
    redirectToPreferences,
    redirectToDashboard,

    /**
     * Verify preferences status with API
     */
    verifyPreferencesStatus,

    /**
     * Handle successful preferences submission
     */
    handlePreferencesSubmitted,

    /**
     * Handle authentication completion from callback
     */
    handleAuthenticationComplete,

    /**
     * Manually trigger preferences flow logic
     */
    handlePreferencesFlow,
  };
}
