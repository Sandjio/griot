"use client";

import React from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { AuthErrorType } from "@/types/auth";

interface AuthErrorBoundaryProps {
  children: React.ReactNode;
  onAuthError?: (error: Error) => void;
}

export const AuthErrorBoundary: React.FC<AuthErrorBoundaryProps> = ({
  children,
  onAuthError,
}) => {
  const handleError = (error: Error) => {
    // Check if this is an authentication-related error
    const isAuthError = Object.values(AuthErrorType).some((type) =>
      error.message.includes(type)
    );

    if (isAuthError) {
      onAuthError?.(error);

      // Clear any stored tokens on auth errors
      if (typeof window !== "undefined") {
        localStorage.removeItem("griot_tokens");
        sessionStorage.removeItem("griot_tokens");
      }
    }
  };

  const authErrorFallback = (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="text-center">
            {/* Auth Error Icon */}
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100">
              <svg
                className="h-6 w-6 text-yellow-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 0h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>

            <h2 className="mt-4 text-lg font-medium text-gray-900">
              Authentication Required
            </h2>

            <p className="mt-2 text-sm text-gray-600">
              Your session has expired or there was an authentication error.
              Please sign in again to continue.
            </p>

            <div className="mt-6">
              <button
                onClick={() => (window.location.href = "/")}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <ErrorBoundary fallback={authErrorFallback} onError={handleError}>
      {children}
    </ErrorBoundary>
  );
};
