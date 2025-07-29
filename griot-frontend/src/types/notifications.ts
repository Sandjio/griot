// Notification system types

export type NotificationType = "success" | "error" | "info" | "warning";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number; // in milliseconds, 0 means no auto-dismiss
  dismissible?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
  createdAt: number;
}

export interface NotificationContextType {
  notifications: Notification[];
  addNotification: (
    notification: Omit<Notification, "id" | "createdAt">
  ) => string;
  removeNotification: (id: string) => void;
  clearAllNotifications: () => void;
  // Convenience methods
  showSuccess: (
    title: string,
    message?: string,
    options?: Partial<Notification>
  ) => string;
  showError: (
    title: string,
    message?: string,
    options?: Partial<Notification>
  ) => string;
  showInfo: (
    title: string,
    message?: string,
    options?: Partial<Notification>
  ) => string;
  showWarning: (
    title: string,
    message?: string,
    options?: Partial<Notification>
  ) => string;
}

export interface NotificationOptions {
  duration?: number;
  dismissible?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}
