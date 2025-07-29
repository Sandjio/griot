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

  // Check if user has authentication tokens
  const hasTokens =
    request.cookies.has("griot_tokens") ||
    (typeof window !== "undefined" && localStorage.getItem("griot_tokens"));

  // For protected routes, redirect to login if not authenticated
  if (protectedRoutes.some((route) => pathname.startsWith(route))) {
    if (!hasTokens) {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("returnUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // For routes that require preferences, provide basic server-side protection
    // The detailed preferences flow logic is handled by the usePreferencesFlow hook
    // on the client side for more accurate state management
    if (preferencesRequiredRoutes.some((route) => pathname.startsWith(route))) {
      // Try to get user preferences status from cookies if available
      const userDataCookie = request.cookies.get("griot_user");
      if (userDataCookie) {
        try {
          const userData = JSON.parse(userDataCookie.value);
          // Basic server-side check: if user clearly doesn't have preferences
          // and is trying to access dashboard, redirect to preferences
          if (!userData.hasPreferences && pathname.startsWith("/dashboard")) {
            return NextResponse.redirect(new URL("/preferences", request.url));
          }
        } catch (error) {
          // If cookie parsing fails, let client-side logic handle it
          console.warn("Failed to parse user data cookie:", error);
        }
      }
      // For other cases, let client-side usePreferencesFlow hook handle the logic
      // This allows for more sophisticated state management and API verification
    }
  }

  // For auth routes, redirect to appropriate page if authenticated
  if (authRoutes.includes(pathname) && hasTokens) {
    // Try to determine where to redirect based on user preferences
    const userDataCookie = request.cookies.get("griot_user");
    if (userDataCookie) {
      try {
        const userData = JSON.parse(userDataCookie.value);
        const redirectUrl = userData.hasPreferences
          ? "/dashboard"
          : "/preferences";
        return NextResponse.redirect(new URL(redirectUrl, request.url));
      } catch (error) {
        // If cookie parsing fails, default to dashboard
        console.warn("Failed to parse user data cookie:", error);
      }
    }
    // Default redirect to dashboard if no user data available
    return NextResponse.redirect(new URL("/dashboard", request.url));
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
