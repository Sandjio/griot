"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AuthErrorType, ApiErrorType } from "@/types";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // Log error to console in development
    if (process.env.NODE_ENV === "development") {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Log error to external service in production
    this.logErrorToService(error, errorInfo);
  }

  private logErrorToService = (error: Error, errorInfo: ErrorInfo) => {
    // In a real application, you would send this to an error tracking service
    // like Sentry, LogRocket, or CloudWatch
    const errorData = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent:
        typeof window !== "undefined" ? window.navigator.userAgent : "unknown",
      url: typeof window !== "undefined" ? window.location.href : "unknown",
    };

    // For now, just log to console
    console.error("Error logged:", errorData);
  };

  private handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  private getErrorType = (error: Error): string => {
    // Check if it's an auth error
    if (
      Object.values(AuthErrorType).some((type) => error.message.includes(type))
    ) {
      return "Authentication Error";
    }

    // Check if it's an API error
    if (
      Object.values(ApiErrorType).some((type) => error.message.includes(type))
    ) {
      return "API Error";
    }

    // Check for common React errors
    if (error.message.includes("ChunkLoadError")) {
      return "Loading Error";
    }

    if (error.message.includes("Network")) {
      return "Network Error";
    }

    return "Application Error";
  };

  private getErrorMessage = (error: Error): string => {
    const errorType = this.getErrorType(error);

    switch (errorType) {
      case "Authentication Error":
        return "There was a problem with authentication. Please try logging in again.";
      case "API Error":
        return "There was a problem connecting to our servers. Please try again.";
      case "Loading Error":
        return "There was a problem loading the application. Please refresh the page.";
      case "Network Error":
        return "Please check your internet connection and try again.";
      default:
        return "Something went wrong. Please try again or contact support if the problem persists.";
    }
  };

  private getRecoveryActions = (error: Error) => {
    const errorType = this.getErrorType(error);

    switch (errorType) {
      case "Authentication Error":
        return [
          { label: "Login Again", action: () => (window.location.href = "/") },
          { label: "Try Again", action: this.handleRetry },
        ];
      case "Loading Error":
        return [
          { label: "Refresh Page", action: () => window.location.reload() },
          { label: "Try Again", action: this.handleRetry },
        ];
      case "Network Error":
        return [
          {
            label: "Check Connection",
            action: () => window.open("https://www.google.com", "_blank"),
          },
          { label: "Try Again", action: this.handleRetry },
        ];
      default:
        return [
          { label: "Try Again", action: this.handleRetry },
          { label: "Go Home", action: () => (window.location.href = "/") },
        ];
    }
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const error = this.state.error!;
      const errorType = this.getErrorType(error);
      const errorMessage = this.getErrorMessage(error);
      const recoveryActions = this.getRecoveryActions(error);

      return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
          <div className="sm:mx-auto sm:w-full sm:max-w-md">
            <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
              <div className="text-center">
                {/* Error Icon */}
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                  <svg
                    className="h-6 w-6 text-red-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                </div>

                {/* Error Title */}
                <h2 className="mt-4 text-lg font-medium text-gray-900">
                  {errorType}
                </h2>

                {/* Error Message */}
                <p className="mt-2 text-sm text-gray-600">{errorMessage}</p>

                {/* Error Details (Development Only) */}
                {process.env.NODE_ENV === "development" && (
                  <details className="mt-4 text-left">
                    <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                      Technical Details
                    </summary>
                    <div className="mt-2 p-3 bg-gray-100 rounded text-xs font-mono text-gray-800 overflow-auto max-h-32">
                      <div className="mb-2">
                        <strong>Error:</strong> {error.message}
                      </div>
                      {error.stack && (
                        <div>
                          <strong>Stack:</strong>
                          <pre className="whitespace-pre-wrap">
                            {error.stack}
                          </pre>
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {/* Recovery Actions */}
                <div className="mt-6 space-y-3">
                  {recoveryActions.map((action, index) => (
                    <button
                      key={index}
                      onClick={action.action}
                      className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                        index === 0
                          ? "bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500"
                          : "bg-gray-600 hover:bg-gray-700 focus:ring-gray-500"
                      } focus:outline-none focus:ring-2 focus:ring-offset-2`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>

                {/* Support Link */}
                <div className="mt-4">
                  <p className="text-xs text-gray-500">
                    If this problem persists, please{" "}
                    <a
                      href="mailto:support@griot.com"
                      className="text-indigo-600 hover:text-indigo-500"
                    >
                      contact support
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook for functional components to trigger error boundary
export const useErrorHandler = () => {
  return (error: Error, errorInfo?: ErrorInfo) => {
    // This will be caught by the nearest error boundary
    throw error;
  };
};

// Higher-order component for easier usage
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode,
  onError?: (error: Error, errorInfo: ErrorInfo) => void
) => {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary fallback={fallback} onError={onError}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${
    Component.displayName || Component.name
  })`;

  return WrappedComponent;
};
