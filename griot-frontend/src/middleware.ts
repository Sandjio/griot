import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Define protected routes that require authentication
const protectedRoutes = ["/dashboard", "/preferences", "/profile", "/settings"];

// Define auth routes that should redirect authenticated users
const authRoutes = ["/", "/login", "/signup"];

// Define public routes that don't require authentication
const publicRoutes = ["/callback", "/logout"];

// Routes that require preferences to be completed
const preferencesRequiredRoutes = ["/dashboard", "/profile", "/settings"];

/**
 * Check if user has valid authentication tokens
 * This is a server-side check using cookies for middleware access
 */
function hasValidTokens(request: NextRequest): boolean {
  const tokensCookie = request.cookies.get("griot_tokens");

  if (!tokensCookie) {
    return false;
  }

  try {
    // Simple validation - check if tokens exist and are not expired
    // Note: This is basic validation for middleware. Full validation happens client-side
    const tokensData = JSON.parse(decodeURIComponent(tokensCookie.value));

    if (
      !tokensData.accessToken ||
      !tokensData.idToken ||
      !tokensData.refreshToken
    ) {
      return false;
    }

    // Check if tokens are expired (with 5-minute buffer)
    const now = Date.now();
    const buffer = 5 * 60 * 1000; // 5 minutes

    return tokensData.expiresAt > now + buffer;
  } catch (error) {
    // If parsing fails, consider tokens invalid
    return false;
  }
}

/**
 * Get user data from cookies for server-side access
 */
function getUserFromCookies(
  request: NextRequest
): { hasPreferences: boolean } | null {
  const userDataCookie = request.cookies.get("griot_user");

  if (!userDataCookie) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(userDataCookie.value));
  } catch (error) {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static files and API routes
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname.includes(".") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // Check authentication status using improved token validation
  const isAuthenticated = hasValidTokens(request);
  const userData = getUserFromCookies(request);

  // For protected routes, redirect to login if not authenticated
  if (protectedRoutes.some((route) => pathname.startsWith(route))) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("returnUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // For routes that require preferences, check user preferences status
    if (preferencesRequiredRoutes.some((route) => pathname.startsWith(route))) {
      if (userData) {
        // If user clearly doesn't have preferences and is trying to access dashboard
        if (!userData.hasPreferences && pathname.startsWith("/dashboard")) {
          return NextResponse.redirect(new URL("/preferences", request.url));
        }
      }
      // If no user data available, let client-side logic handle the flow
      // This ensures proper API verification of preferences status
    }
  }

  // For auth routes, redirect authenticated users to appropriate page
  if (authRoutes.includes(pathname) && isAuthenticated) {
    if (userData) {
      const redirectUrl = userData.hasPreferences
        ? "/dashboard"
        : "/preferences";
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }
    // Default redirect to dashboard if no user data available
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Handle callback route - allow access regardless of authentication status
  if (pathname === "/callback") {
    return NextResponse.next();
  }

  // Handle logout route - allow access and clear cookies
  if (pathname === "/logout") {
    const response = NextResponse.next();

    // Clear authentication cookies
    response.cookies.delete("griot_tokens");
    response.cookies.delete("griot_user");

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
