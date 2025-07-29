"use client";

import { lazy, Suspense } from "react";
import { UserPreferences } from "../../types/api";

// Lazy load the PreferencesForm component
const PreferencesForm = lazy(() => import("../preferences/PreferencesForm"));

interface LazyPreferencesFormProps {
  onSubmit: (preferences: UserPreferences) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

// Loading component for PreferencesForm
const PreferencesFormSkeleton = () => (
  <div className="max-w-4xl mx-auto p-6">
    {/* Progress Indicator Skeleton */}
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        {[1, 2, 3].map((step) => (
          <div key={step} className="flex items-center flex-1">
            <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse"></div>
            {step < 3 && (
              <div className="flex-1 h-1 mx-4 bg-gray-200 animate-pulse"></div>
            )}
          </div>
        ))}
      </div>
      <div className="text-center">
        <div className="h-8 bg-gray-200 rounded animate-pulse mb-2 mx-auto w-64"></div>
        <div className="h-4 bg-gray-200 rounded animate-pulse mx-auto w-48"></div>
      </div>
    </div>

    {/* Content Skeleton */}
    <div className="mb-8">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 12 }).map((_, index) => (
          <div
            key={index}
            className="h-12 bg-gray-200 rounded-lg animate-pulse"
          ></div>
        ))}
      </div>
    </div>

    {/* Navigation Buttons Skeleton */}
    <div className="flex justify-between">
      <div className="w-24 h-10 bg-gray-200 rounded-lg animate-pulse"></div>
      <div className="w-24 h-10 bg-gray-200 rounded-lg animate-pulse"></div>
    </div>
  </div>
);

export default function LazyPreferencesForm(props: LazyPreferencesFormProps) {
  return (
    <Suspense fallback={<PreferencesFormSkeleton />}>
      <PreferencesForm {...props} />
    </Suspense>
  );
}
