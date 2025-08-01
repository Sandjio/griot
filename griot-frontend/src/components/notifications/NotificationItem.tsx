"use client";

import React, { useEffect, useState } from "react";
import { Notification, NotificationType } from "@/types/notifications";

interface NotificationItemProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

const getNotificationStyles = (type: NotificationType) => {
  const baseStyles = "rounded-lg shadow-lg border-l-4 p-4 max-w-sm w-full";

  switch (type) {
    case "success":
      return `${baseStyles} bg-green-50 border-green-400`;
    case "error":
      return `${baseStyles} bg-red-50 border-red-400`;
    case "warning":
      return `${baseStyles} bg-yellow-50 border-yellow-400`;
    case "info":
      return `${baseStyles} bg-blue-50 border-blue-400`;
    default:
      return `${baseStyles} bg-gray-50 border-gray-400`;
  }
};

const getIconStyles = (type: NotificationType) => {
  switch (type) {
    case "success":
      return "text-green-400";
    case "error":
      return "text-red-400";
    case "warning":
      return "text-yellow-400";
    case "info":
      return "text-blue-400";
    default:
      return "text-gray-400";
  }
};

const getTextStyles = (type: NotificationType) => {
  switch (type) {
    case "success":
      return { title: "text-green-800", message: "text-green-700" };
    case "error":
      return { title: "text-red-800", message: "text-red-700" };
    case "warning":
      return { title: "text-yellow-800", message: "text-yellow-700" };
    case "info":
      return { title: "text-blue-800", message: "text-blue-700" };
    default:
      return { title: "text-gray-800", message: "text-gray-700" };
  }
};

const getIcon = (type: NotificationType) => {
  const iconClass = `h-5 w-5 ${getIconStyles(type)}`;

  switch (type) {
    case "success":
      return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "error":
      return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "warning":
      return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "info":
      return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
      );
    default:
      return null;
  }
};

export const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onDismiss,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const textStyles = getTextStyles(notification.type);

  useEffect(() => {
    // Trigger entrance animation
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setIsExiting(true);
    // Wait for exit animation to complete before removing
    setTimeout(() => onDismiss(notification.id), 300);
  };

  const handleAction = () => {
    if (notification.action) {
      notification.action.onClick();
      handleDismiss();
    }
  };

  return (
    <div
      className={`
        transform transition-all duration-300 ease-in-out
        ${
          isVisible && !isExiting
            ? "translate-x-0 opacity-100"
            : "translate-x-full opacity-0"
        }
      `}
    >
      <div className={getNotificationStyles(notification.type)}>
        <div className="flex">
          <div className="flex-shrink-0">{getIcon(notification.type)}</div>
          <div className="ml-3 flex-1">
            <p className={`text-sm font-medium ${textStyles.title}`}>
              {notification.title}
            </p>
            {notification.message && (
              <p className={`mt-1 text-sm ${textStyles.message}`}>
                {notification.message}
              </p>
            )}
            {notification.action && (
              <div className="mt-2">
                <button
                  onClick={handleAction}
                  className={`text-sm font-medium underline hover:no-underline ${textStyles.title}`}
                >
                  {notification.action.label}
                </button>
              </div>
            )}
          </div>
          {notification.dismissible && (
            <div className="ml-4 flex-shrink-0 flex">
              <button
                onClick={handleDismiss}
                className={`inline-flex rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  notification.type === "success"
                    ? "text-green-500 hover:bg-green-100 focus:ring-green-600"
                    : notification.type === "error"
                    ? "text-red-500 hover:bg-red-100 focus:ring-red-600"
                    : notification.type === "warning"
                    ? "text-yellow-500 hover:bg-yellow-100 focus:ring-yellow-600"
                    : "text-blue-500 hover:bg-blue-100 focus:ring-blue-600"
                }`}
              >
                <span className="sr-only">Dismiss</span>
                <svg
                  className="h-4 w-4"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
