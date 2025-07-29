// Performance monitoring utilities

export interface PerformanceMetrics {
  name: string;
  duration: number;
  timestamp: number;
  type: "navigation" | "resource" | "measure" | "custom";
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private observers: PerformanceObserver[] = [];

  constructor() {
    if (typeof window !== "undefined") {
      this.initializeObservers();
    }
  }

  private initializeObservers() {
    // Observe navigation timing
    if ("PerformanceObserver" in window) {
      try {
        const navObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.recordMetric({
              name: entry.name,
              duration: entry.duration,
              timestamp: entry.startTime,
              type: "navigation",
            });
          }
        });
        navObserver.observe({ entryTypes: ["navigation"] });
        this.observers.push(navObserver);

        // Observe resource loading
        const resourceObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.recordMetric({
              name: entry.name,
              duration: entry.duration,
              timestamp: entry.startTime,
              type: "resource",
            });
          }
        });
        resourceObserver.observe({ entryTypes: ["resource"] });
        this.observers.push(resourceObserver);

        // Observe custom measures
        const measureObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.recordMetric({
              name: entry.name,
              duration: entry.duration,
              timestamp: entry.startTime,
              type: "measure",
            });
          }
        });
        measureObserver.observe({ entryTypes: ["measure"] });
        this.observers.push(measureObserver);
      } catch (error) {
        console.warn("Performance monitoring not supported:", error);
      }
    }
  }

  private recordMetric(metric: PerformanceMetrics) {
    this.metrics.push(metric);

    // Keep only last 100 metrics to prevent memory leaks
    if (this.metrics.length > 100) {
      this.metrics = this.metrics.slice(-100);
    }

    // Log slow operations in development
    if (process.env.NODE_ENV === "development" && metric.duration > 1000) {
      console.warn(
        `Slow operation detected: ${metric.name} took ${metric.duration}ms`
      );
    }
  }

  // Mark the start of a custom operation
  mark(name: string) {
    if (typeof window !== "undefined" && "performance" in window) {
      performance.mark(`${name}-start`);
    }
  }

  // Mark the end of a custom operation and measure duration
  measure(name: string) {
    if (typeof window !== "undefined" && "performance" in window) {
      try {
        performance.mark(`${name}-end`);
        performance.measure(name, `${name}-start`, `${name}-end`);

        // Clean up marks
        performance.clearMarks(`${name}-start`);
        performance.clearMarks(`${name}-end`);
      } catch (error) {
        console.warn(`Failed to measure ${name}:`, error);
      }
    }
  }

  // Get current metrics
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  // Get metrics by type
  getMetricsByType(type: PerformanceMetrics["type"]): PerformanceMetrics[] {
    return this.metrics.filter((metric) => metric.type === type);
  }

  // Get Core Web Vitals
  getCoreWebVitals() {
    if (typeof window === "undefined") return null;

    const navigation = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming;

    if (!navigation) return null;

    return {
      // First Contentful Paint
      fcp: this.getMetricsByType("navigation").find((m) =>
        m.name.includes("first-contentful-paint")
      )?.duration,

      // Largest Contentful Paint
      lcp: this.getMetricsByType("navigation").find((m) =>
        m.name.includes("largest-contentful-paint")
      )?.duration,

      // Time to Interactive (using loadEventEnd as approximation)
      tti: navigation.loadEventEnd,

      // Total Blocking Time (approximation)
      tbt:
        navigation.domContentLoadedEventEnd -
        navigation.domContentLoadedEventStart,
    };
  }

  // Clean up observers
  disconnect() {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers = [];
    this.metrics = [];
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Utility functions for common performance measurements
export const measureAsync = async <T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> => {
  performanceMonitor.mark(name);
  try {
    const result = await fn();
    performanceMonitor.measure(name);
    return result;
  } catch (error) {
    performanceMonitor.measure(name);
    throw error;
  }
};

export const measureSync = <T>(name: string, fn: () => T): T => {
  performanceMonitor.mark(name);
  try {
    const result = fn();
    performanceMonitor.measure(name);
    return result;
  } catch (error) {
    performanceMonitor.measure(name);
    throw error;
  }
};

// Report performance metrics (for production monitoring)
export const reportPerformanceMetrics = () => {
  if (typeof window === "undefined") return;

  const metrics = performanceMonitor.getMetrics();
  const coreWebVitals = performanceMonitor.getCoreWebVitals();

  // In a real application, you would send this data to your analytics service
  console.log("Performance Metrics:", {
    metrics: metrics.slice(-10), // Last 10 metrics
    coreWebVitals,
    timestamp: Date.now(),
  });
};

// Preload critical resources
export const preloadCriticalResources = () => {
  if (typeof window === "undefined") return;

  // Preload critical fonts
  const fontPreloads: string[] = [
    // Add your critical fonts here
  ];

  fontPreloads.forEach((font) => {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "font";
    link.type = "font/woff2";
    link.crossOrigin = "anonymous";
    link.href = font;
    document.head.appendChild(link);
  });

  // Preload critical images
  const imagePreloads: string[] = [
    // Add your critical images here
  ];

  imagePreloads.forEach((image) => {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = image;
    document.head.appendChild(link);
  });
};

// Bundle size analyzer (development only)
export const analyzeBundleSize = () => {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined")
    return;

  // Analyze loaded scripts
  const scripts = Array.from(document.querySelectorAll("script[src]"));
  const totalSize = scripts.reduce((size, script) => {
    const src = (script as HTMLScriptElement).src;
    if (src.includes("_next/static")) {
      // Estimate size based on filename patterns
      if (src.includes("chunks/pages")) return size + 50; // ~50KB for page chunks
      if (src.includes("chunks/main")) return size + 200; // ~200KB for main bundle
      if (src.includes("chunks/framework")) return size + 150; // ~150KB for React
      if (src.includes("chunks/webpack")) return size + 10; // ~10KB for webpack runtime
    }
    return size;
  }, 0);

  console.log(`Estimated bundle size: ${totalSize}KB`);

  if (totalSize > 500) {
    console.warn(
      "Bundle size is large. Consider code splitting or lazy loading."
    );
  }
};
