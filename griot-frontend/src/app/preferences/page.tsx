"use client";

import { useState } from "react";
import PreferencesForm from "../../components/preferences/PreferencesForm";
import { UserPreferences } from "../../types/api";
import { useAuthInternal } from "../../hooks/useAuth";
import { usePreferencesFlow } from "../../hooks/usePreferencesFlow";
import { PreferencesApiService } from "../../lib/preferences-api";
import { MainLayout } from "@/components/layout";

export default function PreferencesPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [lastPreferences, setLastPreferences] =
    useState<UserPreferences | null>(null);
  const { user, updateUser } = useAuthInternal();
  const { handlePreferencesSubmitted } = usePreferencesFlow();

  const handleSubmit = async (preferences: UserPreferences) => {
    setIsLoading(true);
    setError(null);
    setRetryable(false);
    setLastPreferences(preferences);

    try {
      // Submit preferences to API
      const result = await PreferencesApiService.submitPreferences(preferences);

      if (result.success && result.data) {
        console.log("Preferences submitted successfully:", result.data);

        // Clear retry state on success
        setLastPreferences(null);
        setRetryable(false);

        // Update user to indicate they have preferences
        if (user) {
          const updatedUser = { ...user, hasPreferences: true };
          updateUser(updatedUser);

          // Also update stored user data to ensure consistency
          import("@/lib/auth").then(({ UserManager }) => {
            UserManager.storeUser(updatedUser);
          });
        }

        // Use preferences flow hook to handle navigation
        handlePreferencesSubmitted();
      } else if (result.error) {
        // Handle API error with user-friendly message
        setError(result.error.message);
        setRetryable(result.error.retryable);

        // If authentication error, the API client will handle token refresh automatically
        // If it's a logout-triggering error, the auth context will handle it
        if (result.error.shouldLogout) {
          // The auth context will handle logout automatically
          console.log("Authentication error detected, user will be logged out");
        }
      } else {
        setError("Failed to save preferences. Please try again.");
        setRetryable(true);
      }
    } catch (err) {
      console.error("Unexpected error saving preferences:", err);
      setError("An unexpected error occurred. Please try again.");
      setRetryable(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    if (lastPreferences) {
      handleSubmit(lastPreferences);
    }
  };

  return (
    <MainLayout>
      <div className="py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Set Up Your Manga Preferences
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Help us personalize your manga experience by telling us about your
            preferences. This will help us generate stories that match your
            interests.
          </p>
        </div>

        <PreferencesForm
          onSubmit={handleSubmit}
          isLoading={isLoading}
          error={error}
        />

        {/* Retry Button */}
        {error && retryable && lastPreferences && (
          <div className="max-w-4xl mx-auto mt-6 text-center">
            <button
              onClick={handleRetry}
              disabled={isLoading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Retrying..." : "Try Again"}
            </button>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
