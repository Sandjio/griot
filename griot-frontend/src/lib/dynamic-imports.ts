import { lazy } from "react";

// Utility for creating lazy-loaded components with better error handling
export const createLazyComponent = (
  importFn: () => Promise<{ default: React.ComponentType<any> }>,
  displayName?: string
) => {
  const LazyComponent = lazy(importFn);

  // Set displayName for debugging purposes
  if (displayName && typeof LazyComponent === "object") {
    try {
      Object.defineProperty(LazyComponent, "displayName", {
        value: displayName,
        writable: false,
        configurable: true,
      });
    } catch {
      // Ignore if displayName cannot be set
    }
  }

  return LazyComponent;
};

// Pre-defined lazy components for better tree shaking
export const LazyComponents = {
  // Auth components
  AuthButtons: lazy(() => import("../components/auth/AuthButtons")),

  // Form components
  PreferencesForm: lazy(
    () => import("../components/preferences/PreferencesForm")
  ),

  // Page components
  DashboardPage: lazy(() => import("../app/dashboard/page")),

  PreferencesPage: lazy(() => import("../app/preferences/page")),

  CallbackPage: lazy(() => import("../app/callback/page")),
} as const;

// Preload functions for critical components
export const preloadComponents = {
  authButtons: () => import("../components/auth/AuthButtons"),
  preferencesForm: () => import("../components/preferences/PreferencesForm"),
  dashboard: () => import("../app/dashboard/page"),
  preferences: () => import("../app/preferences/page"),
  callback: () => import("../app/callback/page"),
};

// Utility to preload components based on user interaction
export const preloadOnHover = (
  componentKey: keyof typeof preloadComponents
) => {
  return {
    onMouseEnter: () => {
      preloadComponents[componentKey]();
    },
    onFocus: () => {
      preloadComponents[componentKey]();
    },
  };
};

// Utility to preload components based on route
export const preloadForRoute = (route: string) => {
  switch (route) {
    case "/dashboard":
      preloadComponents.dashboard();
      break;
    case "/preferences":
      preloadComponents.preferencesForm();
      break;
    case "/callback":
      preloadComponents.callback();
      break;
    default:
      // Preload auth buttons for landing page
      preloadComponents.authButtons();
  }
};
