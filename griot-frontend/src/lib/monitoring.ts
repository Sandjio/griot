// Error tracking and performance monitoring

import { config } from "./config";
import { performanceMonitor } from "./performance";

export interface ErrorReport {
  message: string;
  stack?: string;
  url: string;
  lineNumber?: number;
  columnNumber?: number;
  userAgent: string;
  timestamp: number;
  userId?: string;
  sessionId: string;
  buildVersion?: string;
  environment: string;
  additionalData?: Record<string, unknown>;
}

export interface PerformanceReport {
  metrics: {
    fcp?: number;
    lcp?: number;
    fid?: number;
    cls?: number;
    ttfb?: number;
  };
  navigation: {
    type: string;
    redirectCount: number;
    timing: Record<string, number>;
  };
  resources: Array<{
    name: string;
    type: string;
    duration: number;
    size?: number;
  }>;
  userAgent: string;
  timestamp: number;
  url: string;
  sessionId: string;
  environment: string;
}

class MonitoringService {
  private sessionId: string;
  private userId?: string;
  private buildVersion?: string;
  private errorQueue: ErrorReport[] = [];
  private performanceQueue: PerformanceReport[] = [];
  private isOnline = true;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || "unknown";

    if (typeof window !== "undefined") {
      this.initializeMonitoring();
    }
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private initializeMonitoring() {
    // Global error handler
    window.addEventListener("error", (event) => {
      this.reportError({
        message: event.message,
        stack: event.error?.stack,
        url: event.filename || window.location.href,
        lineNumber: event.lineno,
        columnNumber: event.colno,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
        userId: this.userId,
        sessionId: this.sessionId,
        buildVersion: this.buildVersion,
        environment: config.environment,
      });
    });

    // Unhandled promise rejection handler
    window.addEventListener("unhandledrejection", (event) => {
      this.reportError({
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
        userId: this.userId,
        sessionId: this.sessionId,
        buildVersion: this.buildVersion,
        environment: config.environment,
        additionalData: {
          type: "unhandledrejection",
          reason: event.reason,
        },
      });
    });

    // Network status monitoring
    window.addEventListener("online", () => {
      this.isOnline = true;
      this.flushQueues();
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
    });

    // Performance monitoring
    if (config.performance.enablePerformanceMonitoring) {
      this.initializePerformanceMonitoring();
    }

    // Periodic queue flush
    setInterval(() => {
      if (this.isOnline) {
        this.flushQueues();
      }
    }, 30000); // Flush every 30 seconds

    // Flush on page unload
    window.addEventListener("beforeunload", () => {
      this.flushQueues();
    });
  }

  private initializePerformanceMonitoring() {
    // Core Web Vitals monitoring
    if ("PerformanceObserver" in window) {
      try {
        // Largest Contentful Paint
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          this.reportPerformanceMetric("lcp", lastEntry.startTime);
        });
        lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });

        // First Input Delay
        const fidObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach((entry) => {
            const fidEntry = entry as any; // Type assertion for FID entry
            this.reportPerformanceMetric(
              "fid",
              fidEntry.processingStart - entry.startTime
            );
          });
        });
        fidObserver.observe({ entryTypes: ["first-input"] });

        // Cumulative Layout Shift
        const clsObserver = new PerformanceObserver((list) => {
          let clsValue = 0;
          const entries = list.getEntries();
          entries.forEach((entry) => {
            const clsEntry = entry as any; // Type assertion for CLS entry
            if (!clsEntry.hadRecentInput) {
              clsValue += clsEntry.value;
            }
          });
          this.reportPerformanceMetric("cls", clsValue);
        });
        clsObserver.observe({ entryTypes: ["layout-shift"] });

        // Time to First Byte
        window.addEventListener("load", () => {
          const navigation = performance.getEntriesByType(
            "navigation"
          )[0] as PerformanceNavigationTiming;
          if (navigation) {
            this.reportPerformanceMetric(
              "ttfb",
              navigation.responseStart - navigation.requestStart
            );
          }
        });
      } catch (error) {
        console.warn("Performance monitoring not supported:", error);
      }
    }

    // Report performance data periodically
    setTimeout(() => {
      this.reportPerformanceData();
    }, 5000); // Report after 5 seconds
  }

  private reportPerformanceMetric(metric: string, value: number) {
    if (config.performance.enablePerformanceMonitoring) {
      console.log(`Performance metric - ${metric}:`, value);

      // In a real application, you would send this to your monitoring service
      // For now, we'll just log it
    }
  }

  private reportPerformanceData() {
    if (!config.performance.enablePerformanceMonitoring) return;

    const coreWebVitals = performanceMonitor.getCoreWebVitals();
    const navigation = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType("resource").slice(0, 50); // Limit to 50 resources

    const report: PerformanceReport = {
      metrics: {
        fcp: coreWebVitals?.fcp,
        lcp: coreWebVitals?.lcp,
        ttfb: coreWebVitals?.tti,
      },
      navigation: {
        type: navigation?.type || "unknown",
        redirectCount: navigation?.redirectCount || 0,
        timing: {
          domContentLoaded:
            navigation?.domContentLoadedEventEnd -
              navigation?.domContentLoadedEventStart || 0,
          loadComplete:
            navigation?.loadEventEnd - navigation?.loadEventStart || 0,
        },
      },
      resources: resources.map((resource) => ({
        name: resource.name,
        type: (resource as any).initiatorType || "unknown",
        duration: resource.duration,
        size: (resource as any).transferSize,
      })),
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
      url: window.location.href,
      sessionId: this.sessionId,
      environment: config.environment,
    };

    this.queuePerformanceReport(report);
  }

  public setUserId(userId: string) {
    this.userId = userId;
  }

  public reportError(error: Partial<ErrorReport>) {
    const fullError: ErrorReport = {
      message: error.message || "Unknown error",
      stack: error.stack,
      url: error.url || window.location.href,
      lineNumber: error.lineNumber,
      columnNumber: error.columnNumber,
      userAgent: error.userAgent || navigator.userAgent,
      timestamp: error.timestamp || Date.now(),
      userId: error.userId || this.userId,
      sessionId: error.sessionId || this.sessionId,
      buildVersion: error.buildVersion || this.buildVersion,
      environment: error.environment || config.environment,
      additionalData: error.additionalData,
    };

    this.queueErrorReport(fullError);
  }

  public reportCustomEvent(eventName: string, data?: Record<string, unknown>) {
    if (!config.performance.enableAnalytics) return;

    const event = {
      name: eventName,
      data,
      timestamp: Date.now(),
      url: window.location.href,
      userId: this.userId,
      sessionId: this.sessionId,
      environment: config.environment,
    };

    console.log("Custom event:", event);
    // In a real application, you would send this to your analytics service
  }

  private queueErrorReport(error: ErrorReport) {
    this.errorQueue.push(error);

    // Limit queue size
    if (this.errorQueue.length > 100) {
      this.errorQueue = this.errorQueue.slice(-50);
    }

    // Try to send immediately if online
    if (this.isOnline) {
      this.flushErrorQueue();
    }
  }

  private queuePerformanceReport(report: PerformanceReport) {
    this.performanceQueue.push(report);

    // Limit queue size
    if (this.performanceQueue.length > 10) {
      this.performanceQueue = this.performanceQueue.slice(-5);
    }

    // Try to send immediately if online
    if (this.isOnline) {
      this.flushPerformanceQueue();
    }
  }

  private async flushQueues() {
    await Promise.all([this.flushErrorQueue(), this.flushPerformanceQueue()]);
  }

  private async flushErrorQueue() {
    if (this.errorQueue.length === 0 || !config.performance.enableErrorTracking)
      return;

    const errors = [...this.errorQueue];
    this.errorQueue = [];

    try {
      // In a real application, you would send errors to your monitoring service
      // For now, we'll just log them
      console.log("Flushing error reports:", errors);

      // Example: await fetch('/api/errors', { method: 'POST', body: JSON.stringify(errors) });
    } catch (error) {
      console.error("Failed to send error reports:", error);
      // Re-queue errors on failure
      this.errorQueue.unshift(...errors);
    }
  }

  private async flushPerformanceQueue() {
    if (
      this.performanceQueue.length === 0 ||
      !config.performance.enablePerformanceMonitoring
    )
      return;

    const reports = [...this.performanceQueue];
    this.performanceQueue = [];

    try {
      // In a real application, you would send performance data to your monitoring service
      // For now, we'll just log them
      console.log("Flushing performance reports:", reports);

      // Example: await fetch('/api/performance', { method: 'POST', body: JSON.stringify(reports) });
    } catch (error) {
      console.error("Failed to send performance reports:", error);
      // Re-queue reports on failure
      this.performanceQueue.unshift(...reports);
    }
  }

  public getSessionInfo() {
    return {
      sessionId: this.sessionId,
      userId: this.userId,
      buildVersion: this.buildVersion,
      environment: config.environment,
      isOnline: this.isOnline,
      queueSizes: {
        errors: this.errorQueue.length,
        performance: this.performanceQueue.length,
      },
    };
  }
}

// Singleton instance
export const monitoringService = new MonitoringService();

// Convenience functions
export const reportError = (error: Partial<ErrorReport>) => {
  monitoringService.reportError(error);
};

export const reportCustomEvent = (
  eventName: string,
  data?: Record<string, unknown>
) => {
  monitoringService.reportCustomEvent(eventName, data);
};

export const setUserId = (userId: string) => {
  monitoringService.setUserId(userId);
};

// React error boundary integration
export const createErrorBoundaryHandler = (componentName: string) => {
  return (error: Error, errorInfo: React.ErrorInfo) => {
    reportError({
      message: `React Error Boundary: ${error.message}`,
      stack: error.stack,
      additionalData: {
        componentName,
        componentStack: errorInfo.componentStack,
        errorBoundary: true,
      },
    });
  };
};

// Development helpers
if (config.environment === "development" && typeof window !== "undefined") {
  // Expose monitoring service for debugging
  (window as unknown).__monitoring = monitoringService;
}
