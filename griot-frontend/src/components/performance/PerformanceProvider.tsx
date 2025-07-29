"use client";

import { useEffect } from "react";
import {
  performanceMonitor,
  preloadCriticalResources,
  reportPerformanceMetrics,
  analyzeBundleSize,
} from "@/lib/performance";
import { preloadForRoute } from "@/lib/dynamic-imports";
import { reportCustomEvent } from "@/lib/monitoring";
import { config } from "@/lib/config";

interface PerformanceProviderProps {
  children: React.ReactNode;
}

export function PerformanceProvider({ children }: PerformanceProviderProps) {
  useEffect(() => {
    // Initialize performance monitoring
    preloadCriticalResources();

    // Preload components based on current route
    const currentPath = window.location.pathname;
    preloadForRoute(currentPath);

    // Report page view
    reportCustomEvent("page_view", {
      path: currentPath,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
    });

    // Analyze bundle size in development
    if (config.environment === "development") {
      setTimeout(analyzeBundleSize, 1000);
    }

    // Report performance metrics after page load
    const reportMetrics = () => {
      setTimeout(() => {
        reportPerformanceMetrics();
        reportCustomEvent("page_load_complete", {
          path: currentPath,
          loadTime: performance.now(),
        });
      }, 2000);
    };

    if (document.readyState === "complete") {
      reportMetrics();
    } else {
      window.addEventListener("load", reportMetrics);
    }

    // Report visibility changes
    const handleVisibilityChange = () => {
      reportCustomEvent("visibility_change", {
        hidden: document.hidden,
        visibilityState: document.visibilityState,
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup on unmount
    return () => {
      performanceMonitor.disconnect();
      window.removeEventListener("load", reportMetrics);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return <>{children}</>;
}
