"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthUtils, UserManager } from "@/lib/auth";
import { AuthError, AuthErrorType } from "@/types/auth";
import { apiService } from "@/lib/api";
import { usePreferencesFlow } from "@/hooks/usePreferencesFlow";

interface CallbackState {
  status: "loading" | "success" | "error";
  error?: AuthError;
  message?: string;
  errorType?:
    | "oauth"
    | "network"
    | "validation"
    | "csrf"
    | "preferences"
    | "unknown";
}

// Helper functions for error handling
function getErrorTitle(errorType?: CallbackState["errorType"]): string {
  switch (errorType) {
    case "oauth":
      return "OAuth Authentication Failed";
    case "network":
      return "Network Connection Error";
    case "validation":
      return "Authentication Validation Failed";
    case "csrf":
      return "Security Validation Failed";
    case "preferences":
      return "Preferences Check Failed";
    default:
      return "Authentication Failed";
  }
}

function getErrorContext(
  errorType?: CallbackState["errorType"]
): string | null {
  switch (errorType) {
    case "oauth":
      return "There was an issue with the OAuth authentication process. This could be due to an expired authorization code or invalid OAuth parameters.";
    case "network":
      return "Please check your internet connection and ensure you can access the authentication service.";
    case "validation":
      return "The authentication response could not be validated. This may indicate a temporary service issue.";
    case "csrf":
      return "The authentication request failed security validation. This could indicate a potential security issue or expired session. Please try logging in again.";
    case "preferences":
      return "Authentication was successful, but we couldn't check your user preferences. You can continue to set up your preferences manually.";
    default:
      return null;
  }
}

// Component to display error context
const ErrorContextDisplay: React.FC<{
  errorType?: CallbackState["errorType"];
}> = ({ errorType }) => {
  const context = getErrorContext(errorType);

  if (!context) {
    return null;
  }

  return (
    <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded text-left text-sm">
      <p className="text-blue-800">{context}</p>
    </div>
  );
};

function CallbackPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<CallbackState>({ status: "loading" });
  const { handleAuthenticationComplete } = usePreferencesFlow();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        setState({
          status: "loading",
          message: "Validating authentication parameters...",
        });

        // Validate that we have the required search parameters
        const code = searchParams.get("code");
        const state = searchParams.get("state");
        const error = searchParams.get("error");
        const errorDescription = searchParams.get("error_description");

        // Check for OAuth errors first
        if (error) {
          let errorType: CallbackState["errorType"] = "oauth";
          let message = errorDescription || `OAuth error: ${error}`;

          // Categorize specific OAuth errors
          if (error === "access_denied") {
            message = "Authentication was cancelled or access was denied.";
          } else if (error === "invalid_request") {
            message =
              "Invalid authentication request. Please try logging in again.";
          } else if (error === "unauthorized_client") {
            message =
              "Authentication service configuration error. Please contact support.";
          } else if (error === "unsupported_response_type") {
            message =
              "Authentication method not supported. Please contact support.";
          } else if (error === "invalid_scope") {
            message = "Invalid authentication scope. Please contact support.";
          } else if (error === "server_error") {
            message = "Authentication server error. Please try again later.";
            errorType = "network";
          } else if (error === "temporarily_unavailable") {
            message =
              "Authentication service is temporarily unavailable. Please try again later.";
            errorType = "network";
          }

          setState({
            status: "error",
            error: {
              type: AuthErrorType.COGNITO_ERROR,
              message,
              details: { error, errorDescription },
              recoverable: errorType === "network",
            },
            errorType,
          });
          return;
        }

        // Validate required parameters
        if (!code || !state) {
          setState({
            status: "error",
            error: {
              type: AuthErrorType.VALIDATION_ERROR,
              message:
                "Missing required authentication parameters. Please try logging in again.",
              details: { hasCode: !!code, hasState: !!state },
              recoverable: false,
            },
            errorType: "validation",
          });
          return;
        }

        setState({
          status: "loading",
          message: "Processing authentication...",
        });

        // Handle the OAuth callback
        const result = await AuthUtils.handleCallback(searchParams);

        if (result.success && result.user) {
          setState({
            status: "loading",
            message: "Checking user preferences...",
          });

          // Check if user has preferences by making API call
          let hasPreferences = false;
          try {
            const preferencesResult = await apiService.get(
              "/preferences",
              "check user preferences"
            );
            hasPreferences =
              preferencesResult.success && !!preferencesResult.data;
          } catch (error) {
            // If preferences check fails, assume no preferences (will redirect to preferences page)
            console.warn("Failed to check user preferences:", error);
            hasPreferences = false;
          }

          // Update user object with preferences status
          const updatedUser = { ...result.user, hasPreferences };
          UserManager.storeUser(updatedUser);

          setState({
            status: "success",
            message: "Authentication successful! Redirecting...",
          });

          // Use preferences flow hook to handle redirection
          handleAuthenticationComplete({ hasPreferences });
        } else {
          // Categorize the error for better user feedback
          const authError = result.error || {
            type: AuthErrorType.VALIDATION_ERROR,
            message: "Authentication failed",
            recoverable: false,
          };

          let errorType: CallbackState["errorType"] = "unknown";

          // Categorize error based on type and message
          if (authError.type === AuthErrorType.COGNITO_ERROR) {
            if (
              authError.message.includes("state") ||
              authError.message.includes("CSRF")
            ) {
              errorType = "csrf";
            } else {
              errorType = "oauth";
            }
          } else if (authError.type === AuthErrorType.NETWORK_ERROR) {
            errorType = "network";
          } else if (authError.type === AuthErrorType.VALIDATION_ERROR) {
            errorType = "validation";
          }

          setState({
            status: "error",
            error: authError,
            errorType,
          });
        }
      } catch (error) {
        console.error("Callback handling error:", error);

        // Determine error type based on the caught error
        let errorType: CallbackState["errorType"] = "unknown";
        let authError: AuthError;

        if (error instanceof Error) {
          if (
            error.message.includes("network") ||
            error.message.includes("fetch")
          ) {
            errorType = "network";
            authError = {
              type: AuthErrorType.NETWORK_ERROR,
              message:
                "Network error during authentication. Please check your connection and try again.",
              details: error,
              recoverable: true,
            };
          } else if (error.message.includes("preferences")) {
            errorType = "preferences";
            authError = {
              type: AuthErrorType.VALIDATION_ERROR,
              message:
                "Authentication succeeded but failed to check user preferences. You may need to set up your preferences.",
              details: error,
              recoverable: true,
            };
          } else {
            authError = {
              type: AuthErrorType.VALIDATION_ERROR,
              message: "An unexpected error occurred during authentication",
              details: error,
              recoverable: false,
            };
          }
        } else {
          authError = {
            type: AuthErrorType.VALIDATION_ERROR,
            message: "An unexpected error occurred during authentication",
            details: error instanceof Error ? error : String(error),
            recoverable: false,
          };
        }

        setState({
          status: "error",
          error: authError,
          errorType,
        });
      }
    };

    handleCallback();
  }, [searchParams, router, handleAuthenticationComplete]);

  const handleRetry = () => {
    setState({ status: "loading" });
    // Retry the callback handling
    window.location.reload();
  };

  const handleBackToLogin = () => {
    router.replace("/");
  };

  if (state.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Authenticating...
            </h2>
            <p className="text-gray-600">
              {state.message ||
                "Please wait while we process your authentication."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-blue-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Authentication Successful!
            </h2>
            <p className="text-gray-600">
              {state.message ||
                "You have been successfully authenticated. Redirecting..."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {getErrorTitle(state.errorType)}
          </h2>
          <p className="text-gray-600 mb-6">
            {state.error?.message || "An error occurred during authentication."}
          </p>

          {/* Additional context based on error type */}
          <ErrorContextDisplay errorType={state.errorType} />

          {/* Error details for debugging (only in development) */}
          {process.env.NODE_ENV === "development" && state.error?.details && (
            <div className="mb-6 p-3 bg-gray-100 rounded text-left text-sm">
              <p className="font-medium text-gray-700 mb-1">Debug Info:</p>
              <p className="text-gray-600 font-mono text-xs">
                Type: {state.error.type}
              </p>
              {state.error.details && (
                <p className="text-gray-600 font-mono text-xs mt-1">
                  Details: {JSON.stringify(state.error.details, null, 2)}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            {state.error?.recoverable && (
              <button
                onClick={handleRetry}
                className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 transition-colors"
              >
                Try Again
              </button>
            )}
            {state.errorType === "preferences" && (
              <button
                onClick={() => router.replace("/preferences")}
                className="flex-1 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors"
              >
                Continue to Preferences
              </button>
            )}
            <button
              onClick={handleBackToLogin}
              className="flex-1 bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 transition-colors"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50">
          <div className="max-w-md w-full mx-4">
            <div className="bg-white rounded-lg shadow-lg p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Loading...
              </h2>
              <p className="text-gray-600">
                Please wait while we prepare the authentication page.
              </p>
            </div>
          </div>
        </div>
      }
    >
      <CallbackPageContent />
    </Suspense>
  );
}
