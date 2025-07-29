"use client";

import { lazy, Suspense } from "react";

// Lazy load the AuthButtons component
const AuthButtons = lazy(() => import("../auth/AuthButtons"));

// Loading component for AuthButtons
const AuthButtonsSkeleton = () => (
  <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
    {/* Sign Up Button Skeleton */}
    <div className="h-16 w-48 bg-gradient-to-r from-gray-200 to-gray-300 rounded-full animate-pulse"></div>

    {/* Login Button Skeleton */}
    <div className="h-16 w-48 bg-gray-200 border-2 border-gray-300 rounded-full animate-pulse"></div>
  </div>
);

export default function LazyAuthButtons() {
  return (
    <Suspense fallback={<AuthButtonsSkeleton />}>
      <AuthButtons />
    </Suspense>
  );
}
