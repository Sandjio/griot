"use client";

import { useNotifications } from "@/contexts/NotificationContext";
import { AuthErrorType, ApiErrorType } from "@/types";
import { NotificationOptions } from "@/types/notifications";

export const useNotification = () => {
  const notifications = useNotifications();

  // Enhanced error notification that handles different error types
  const showErrorNotification = (
    error: Error | string,
    options?: NotificationOptions
  ) => {
    const errorMessage = typeof error === "string" ? error : error.message;

    // Determine error type and customize notification
    let title = "Error";
    let message = errorMessage;
    const customOptions: NotificationOptions = { ...options };

    // Handle authentication errors
    if (
      Object.values(AuthErrorType).some((type) => errorMessage.includes(type))
    ) {
      title = "Authentication Error";
      message = "Please sign in again to continue.";
      customOptions.action = {
        label: "Sign In",
        onClick: () => (window.location.href = "/"),
      };
    }
    // Handle API errors
    else if (
      Object.values(ApiErrorType).some((type) => errorMessage.includes(type))
    ) {
      title = "Connection Error";
      message = "Please check your connection and try again.";
      customOptions.action = {
        label: "Retry",
        onClick: () => window.location.reload(),
      };
    }
    // Handle network errors
    else if (errorMessage.toLowerCase().includes("network")) {
      title = "Network Error";
      message = "Please check your internet connection.";
    }
    // Handle validation errors
    else if (errorMessage.toLowerCase().includes("validation")) {
      title = "Validation Error";
      message = "Please check your input and try again.";
    }

    return notifications.showError(title, message, customOptions);
  };

  // Success notification with common patterns
  const showSuccessNotification = (
    action: string,
    details?: string,
    options?: NotificationOptions
  ) => {
    const title = `${action} Successful`;
    return notifications.showSuccess(title, details, options);
  };

  // Info notification for user guidance
  const showInfoNotification = (
    title: string,
    message?: string,
    options?: NotificationOptions
  ) => {
    return notifications.showInfo(title, message, options);
  };

  // Warning notification for important information
  const showWarningNotification = (
    title: string,
    message?: string,
    options?: NotificationOptions
  ) => {
    return notifications.showWarning(title, message, options);
  };

  // Convenience method for API success responses
  const showApiSuccess = (operation: string, details?: string) => {
    return showSuccessNotification(operation, details, {
      duration: 3000,
    });
  };

  // Convenience method for API errors
  const showApiError = (error: Error | string, operation?: string) => {
    const title = operation ? `${operation} Failed` : "Operation Failed";
    const message = typeof error === "string" ? error : error.message;

    return notifications.showError(title, message, {
      duration: 0, // Don't auto-dismiss errors
      action: {
        label: "Retry",
        onClick: () => window.location.reload(),
      },
    });
  };

  // Method for showing loading notifications (can be dismissed programmatically)
  const showLoadingNotification = (operation: string) => {
    return notifications.showInfo(`${operation}...`, "Please wait", {
      duration: 0, // Don't auto-dismiss
      dismissible: false,
    });
  };

  // Method for authentication-related notifications
  const showAuthNotification = (
    type: "login" | "logout" | "signup" | "error",
    details?: string
  ) => {
    switch (type) {
      case "login":
        return showSuccessNotification("Login", details || "Welcome back!");
      case "logout":
        return showSuccessNotification(
          "Logout",
          details || "You have been signed out."
        );
      case "signup":
        return showSuccessNotification(
          "Account Created",
          details || "Welcome to Griot!"
        );
      case "error":
        return showErrorNotification(details || "Authentication failed");
      default:
        return "";
    }
  };

  return {
    // Original methods
    ...notifications,

    // Enhanced methods
    showErrorNotification,
    showSuccessNotification,
    showInfoNotification,
    showWarningNotification,

    // Convenience methods
    showApiSuccess,
    showApiError,
    showLoadingNotification,
    showAuthNotification,
  };
};
