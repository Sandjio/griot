"use client";

import { useEffect, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "./useAuth";

/**
 * Configuration options for authentication redirect behavior
 */
interface AuthRedirectOptions {
  /**
   * Whether to redirect unauthenticated users to login
   * @default true
   */
  requireAuth?: boolean;

  /**
   * Whether to redirect authenticated users away from auth pages
   * @default false
   */
  redirectIfAuthenticated?: boolean;

  /**
   * Custom redirect path for unauthenticated users
   * @default "/"
   */
  loginRedirect?: string;

  /**
   * Custom redirect path for authenticated users
   * @default "/dashboard"
   */
  authenticatedRedirect?: string;

  /**
   * Whether to preserve the current path as a return URL
   * @default true
   */
  preserveReturnUrl?: boolean;

  /**
   * Custom loading behavior during authentication check
   * @default false
   */
  showLoadingDuringCheck?: boolean;
}

/**
 * Custom hook for route protection and authentication-based redirects
 *
 * This hook handles automatic redirects based on authentication state
 * and provides utilities for protected routes.
 */
export function useAuthRedirect(options: AuthRedirectOptions = {}) {
  const {
    requireAuth = true,
    redirectIfAuthenticated = false,
    loginRedirect = "/",
    authenticatedRedirect = "/dashboard",
    preserveReturnUrl = true,
    showLoadingDuringCheck = false,
  } = options;

  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Check if current route should be protected
   */
  const isProtectedRoute = useCallback((): boolean => {
    const protectedPaths = [
      "/dashboard",
      "/preferences",
      "/profile",
      "/settings",
    ];

    return protectedPaths.some((path) => pathname.startsWith(path));
  }, [pathname]);

  /**
   * Check if current route is an auth-related page
   */
  const isAuthRoute = useCallback((): boolean => {
    const authPaths = ["/", "/login", "/signup", "/callback", "/logout"];

    return authPaths.includes(pathname);
  }, [pathname]);

  /**
   * Build redirect URL with return path if needed
   */
  const buildRedirectUrl = useCallback(
    (targetPath: string): string => {
      if (!preserveReturnUrl || isAuthRoute()) {
        return targetPath;
      }

      const returnUrl = encodeURIComponent(
        pathname +
          (searchParams.toString() ? `?${searchParams.toString()}` : "")
      );
      const separator = targetPath.includes("?") ? "&" : "?";

      return `${targetPath}${separator}returnUrl=${returnUrl}`;
    },
    [pathname, searchParams, preserveReturnUrl, isAuthRoute]
  );

  /**
   * Get the return URL from search params
   */
  const getReturnUrl = useCallback((): string => {
    const returnUrl = searchParams.get("returnUrl");

    if (returnUrl) {
      try {
        const decodedUrl = decodeURIComponent(returnUrl);
        // Validate that it's a relative URL for security
        if (decodedUrl.startsWith("/") && !decodedUrl.startsWith("//")) {
          return decodedUrl;
        }
      } catch (error) {
        console.warn("Invalid return URL:", returnUrl);
      }
    }

    return authenticatedRedirect;
  }, [searchParams, authenticatedRedirect]);

  /**
   * Redirect to login with current path as return URL
   */
  const redirectToLogin = useCallback(() => {
    const redirectUrl = buildRedirectUrl(loginRedirect);
    router.push(redirectUrl);
  }, [router, loginRedirect, buildRedirectUrl]);

  /**
   * Redirect to authenticated area or return URL
   */
  const redirectToAuthenticated = useCallback(() => {
    const targetUrl = getReturnUrl();
    router.push(targetUrl);
  }, [router, getReturnUrl]);

  /**
   * Check if user needs to complete preferences
   */
  const needsPreferences = useCallback((): boolean => {
    return Boolean(isAuthenticated && user && !user.hasPreferences);
  }, [isAuthenticated, user]);

  /**
   * Redirect to preferences if needed
   */
  const redirectToPreferences = useCallback(() => {
    if (needsPreferences() && pathname !== "/preferences") {
      router.push("/preferences");
      return true;
    }
    return false;
  }, [needsPreferences, pathname, router]);

  /**
   * Check authentication and handle redirects
   */
  const checkAuthAndRedirect = useCallback(() => {
    // Don't redirect while loading unless explicitly requested
    if (isLoading && !showLoadingDuringCheck) {
      return;
    }

    // Handle unauthenticated users
    if (!isAuthenticated) {
      if (requireAuth && isProtectedRoute()) {
        redirectToLogin();
        return;
      }
      return;
    }

    // Handle authenticated users
    if (isAuthenticated) {
      // Redirect away from auth pages if configured
      if (
        redirectIfAuthenticated &&
        isAuthRoute() &&
        pathname !== "/callback"
      ) {
        redirectToAuthenticated();
        return;
      }

      // Check if user needs to complete preferences
      if (redirectToPreferences()) {
        return;
      }
    }
  }, [
    isLoading,
    showLoadingDuringCheck,
    isAuthenticated,
    requireAuth,
    isProtectedRoute,
    redirectIfAuthenticated,
    isAuthRoute,
    pathname,
    redirectToLogin,
    redirectToAuthenticated,
    redirectToPreferences,
  ]);

  // Run authentication check on mount and when dependencies change
  useEffect(() => {
    checkAuthAndRedirect();
  }, [checkAuthAndRedirect]);

  /**
   * Manual redirect functions for programmatic use
   */
  const redirect = {
    toLogin: redirectToLogin,
    toAuthenticated: redirectToAuthenticated,
    toPreferences: () => router.push("/preferences"),
    toDashboard: () => router.push("/dashboard"),
  };

  return {
    /**
     * Whether the current route requires authentication
     */
    isProtectedRoute: isProtectedRoute(),

    /**
     * Whether the current route is an auth-related page
     */
    isAuthRoute: isAuthRoute(),

    /**
     * Whether user needs to complete preferences
     */
    needsPreferences: needsPreferences(),

    /**
     * Manual redirect functions
     */
    redirect,

    /**
     * Get the return URL from search params
     */
    getReturnUrl,

    /**
     * Build a redirect URL with return path
     */
    buildRedirectUrl,

    /**
     * Manually trigger auth check and redirect
     */
    checkAuthAndRedirect,
  };
}
