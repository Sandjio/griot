"use client";

import { lazy, Suspense } from "react";

// Lazy load the dashboard page component
const DashboardContent = lazy(() => import("../../app/dashboard/page"));

// Loading component for Dashboard
const DashboardSkeleton = () => (
  <div className="min-h-screen bg-gray-50">
    {/* Header Skeleton */}
    <div className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gray-200 rounded-full animate-pulse"></div>
          <div>
            <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 w-64"></div>
            <div className="h-4 bg-gray-200 rounded animate-pulse w-80"></div>
          </div>
        </div>
      </div>
    </div>

    {/* Main Content Skeleton */}
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 w-64"></div>
        <div className="h-4 bg-gray-200 rounded animate-pulse w-96"></div>
      </div>

      {/* Categories Grid Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="bg-white rounded-lg shadow-md p-6 animate-pulse"
          >
            <div className="w-12 h-12 bg-gray-200 rounded-lg mb-4"></div>
            <div className="h-6 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded mb-4"></div>
            <div className="h-10 bg-gray-200 rounded"></div>
          </div>
        ))}
      </div>

      {/* Preferences Summary Skeleton */}
      <div className="mt-12 bg-white rounded-lg shadow-md p-6">
        <div className="h-6 bg-gray-200 rounded animate-pulse mb-4 w-48"></div>
        <div className="h-4 bg-gray-200 rounded animate-pulse mb-4 w-full"></div>
        <div className="w-32 h-10 bg-gray-200 rounded animate-pulse"></div>
      </div>
    </main>
  </div>
);

export default function LazyDashboard() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
