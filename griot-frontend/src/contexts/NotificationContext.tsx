"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
} from "react";
import {
  Notification,
  NotificationContextType,
  NotificationType,
} from "@/types/notifications";
import { v4 as uuidv4 } from "uuid";

// Default durations for different notification types (in milliseconds)
const DEFAULT_DURATIONS: Record<NotificationType, number> = {
  success: 5000,
  info: 5000,
  warning: 7000,
  error: 0, // Error notifications don't auto-dismiss by default
};

// Notification actions
type NotificationAction =
  | { type: "ADD_NOTIFICATION"; payload: Notification }
  | { type: "REMOVE_NOTIFICATION"; payload: string }
  | { type: "CLEAR_ALL_NOTIFICATIONS" };

// Notification reducer
const notificationReducer = (
  state: Notification[],
  action: NotificationAction
): Notification[] => {
  switch (action.type) {
    case "ADD_NOTIFICATION":
      return [...state, action.payload];
    case "REMOVE_NOTIFICATION":
      return state.filter((notification) => notification.id !== action.payload);
    case "CLEAR_ALL_NOTIFICATIONS":
      return [];
    default:
      return state;
  }
};

// Create context
const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined
);

// Provider component
export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [notifications, dispatch] = useReducer(notificationReducer, []);

  // Auto-dismiss notifications
  useEffect(() => {
    const timers: Record<string, NodeJS.Timeout> = {};

    notifications.forEach((notification) => {
      if (
        notification.duration &&
        notification.duration > 0 &&
        !timers[notification.id]
      ) {
        timers[notification.id] = setTimeout(() => {
          dispatch({ type: "REMOVE_NOTIFICATION", payload: notification.id });
          delete timers[notification.id];
        }, notification.duration);
      }
    });

    // Cleanup timers when component unmounts or notifications change
    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer));
    };
  }, [notifications]);

  const addNotification = useCallback(
    (notificationData: Omit<Notification, "id" | "createdAt">): string => {
      const id = uuidv4();
      const notification: Notification = {
        ...notificationData,
        id,
        createdAt: Date.now(),
        duration:
          notificationData.duration ?? DEFAULT_DURATIONS[notificationData.type],
        dismissible: notificationData.dismissible ?? true,
      };

      dispatch({ type: "ADD_NOTIFICATION", payload: notification });
      return id;
    },
    []
  );

  const removeNotification = useCallback((id: string) => {
    dispatch({ type: "REMOVE_NOTIFICATION", payload: id });
  }, []);

  const clearAllNotifications = useCallback(() => {
    dispatch({ type: "CLEAR_ALL_NOTIFICATIONS" });
  }, []);

  // Convenience methods
  const showSuccess = useCallback(
    (
      title: string,
      message?: string,
      options?: Partial<Notification>
    ): string => {
      return addNotification({
        type: "success",
        title,
        message,
        ...options,
      });
    },
    [addNotification]
  );

  const showError = useCallback(
    (
      title: string,
      message?: string,
      options?: Partial<Notification>
    ): string => {
      return addNotification({
        type: "error",
        title,
        message,
        ...options,
      });
    },
    [addNotification]
  );

  const showInfo = useCallback(
    (
      title: string,
      message?: string,
      options?: Partial<Notification>
    ): string => {
      return addNotification({
        type: "info",
        title,
        message,
        ...options,
      });
    },
    [addNotification]
  );

  const showWarning = useCallback(
    (
      title: string,
      message?: string,
      options?: Partial<Notification>
    ): string => {
      return addNotification({
        type: "warning",
        title,
        message,
        ...options,
      });
    },
    [addNotification]
  );

  const value: NotificationContextType = {
    notifications,
    addNotification,
    removeNotification,
    clearAllNotifications,
    showSuccess,
    showError,
    showInfo,
    showWarning,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

// Hook to use notifications
export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error(
      "useNotifications must be used within a NotificationProvider"
    );
  }
  return context;
};
