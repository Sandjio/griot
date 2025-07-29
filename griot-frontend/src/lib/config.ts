// Environment-specific configuration

export interface AppConfig {
  // Environment
  environment: "development" | "staging" | "production";

  // API Configuration
  apiBaseUrl: string;
  apiTimeout: number;

  // Cognito Configuration
  cognito: {
    userPoolId: string;
    clientId: string;
    domain: string;
    redirectUri: string;
    logoutUri: string;
    scopes: string[];
  };

  // Security Configuration
  security: {
    enableCSP: boolean;
    enableHSTS: boolean;
    cookieSecure: boolean;
    cookieSameSite: "strict" | "lax" | "none";
  };

  // Performance Configuration
  performance: {
    enableServiceWorker: boolean;
    enableAnalytics: boolean;
    enableErrorTracking: boolean;
    enablePerformanceMonitoring: boolean;
  };

  // Feature Flags
  features: {
    enableLazyLoading: boolean;
    enablePreloading: boolean;
    enableOfflineMode: boolean;
  };
}

// Base configuration
const baseConfig: Omit<AppConfig, "environment"> = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
  apiTimeout: 30000,

  cognito: {
    userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
    clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
    domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN || "",
    redirectUri:
      process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ||
      "http://localhost:3000/callback",
    logoutUri:
      process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI || "http://localhost:3000",
    scopes: ["openid", "email", "profile"],
  },

  security: {
    enableCSP: true,
    enableHSTS: false, // Will be overridden in production
    cookieSecure: false, // Will be overridden in production
    cookieSameSite: "lax",
  },

  performance: {
    enableServiceWorker: false, // Will be overridden in production
    enableAnalytics: false, // Will be overridden in production
    enableErrorTracking: false, // Will be overridden in production
    enablePerformanceMonitoring: true,
  },

  features: {
    enableLazyLoading: true,
    enablePreloading: true,
    enableOfflineMode: false, // Will be overridden in production
  },
};

// Environment-specific configurations
const environmentConfigs: Record<
  AppConfig["environment"],
  Partial<AppConfig>
> = {
  development: {
    security: {
      enableCSP: false, // Relaxed for development
      enableHSTS: false,
      cookieSecure: false,
      cookieSameSite: "lax",
    },
    performance: {
      enableServiceWorker: false,
      enableAnalytics: false,
      enableErrorTracking: false,
      enablePerformanceMonitoring: true,
    },
  },

  staging: {
    security: {
      enableCSP: true,
      enableHSTS: true,
      cookieSecure: true,
      cookieSameSite: "strict",
    },
    performance: {
      enableServiceWorker: true,
      enableAnalytics: true,
      enableErrorTracking: true,
      enablePerformanceMonitoring: true,
    },
    features: {
      enableLazyLoading: true,
      enablePreloading: true,
      enableOfflineMode: true,
    },
  },

  production: {
    security: {
      enableCSP: true,
      enableHSTS: true,
      cookieSecure: true,
      cookieSameSite: "strict",
    },
    performance: {
      enableServiceWorker: true,
      enableAnalytics: true,
      enableErrorTracking: true,
      enablePerformanceMonitoring: true,
    },
    features: {
      enableLazyLoading: true,
      enablePreloading: true,
      enableOfflineMode: true,
    },
  },
};

// Get current environment
const getCurrentEnvironment = (): AppConfig["environment"] => {
  const env = process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NODE_ENV;

  switch (env) {
    case "production":
      return "production";
    case "staging":
      return "staging";
    case "development":
    default:
      return "development";
  }
};

// Create final configuration
const environment = getCurrentEnvironment();
const environmentConfig = environmentConfigs[environment];

export const config: AppConfig = {
  ...baseConfig,
  ...environmentConfig,
  environment,
  // Deep merge nested objects
  cognito: {
    ...baseConfig.cognito,
    ...environmentConfig.cognito,
  },
  security: {
    ...baseConfig.security,
    ...environmentConfig.security,
  },
  performance: {
    ...baseConfig.performance,
    ...environmentConfig.performance,
  },
  features: {
    ...baseConfig.features,
    ...environmentConfig.features,
  },
};

// Configuration validation
export const validateConfig = (): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Required environment variables
  const requiredEnvVars = [
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
    "NEXT_PUBLIC_COGNITO_CLIENT_ID",
    "NEXT_PUBLIC_COGNITO_DOMAIN",
    "NEXT_PUBLIC_API_BASE_URL",
  ];

  requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
      errors.push(`Missing required environment variable: ${envVar}`);
    }
  });

  // Validate URLs
  try {
    new URL(config.apiBaseUrl);
  } catch {
    errors.push("Invalid API base URL");
  }

  try {
    new URL(config.cognito.redirectUri);
  } catch {
    errors.push("Invalid Cognito redirect URI");
  }

  try {
    new URL(config.cognito.logoutUri);
  } catch {
    errors.push("Invalid Cognito logout URI");
  }

  // Validate Cognito configuration
  if (!config.cognito.userPoolId.match(/^[a-z0-9-]+_[a-zA-Z0-9]+$/)) {
    errors.push("Invalid Cognito User Pool ID format");
  }

  if (!config.cognito.clientId.match(/^[a-z0-9]+$/)) {
    errors.push("Invalid Cognito Client ID format");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Export individual configurations for convenience
export const {
  apiBaseUrl,
  apiTimeout,
  cognito,
  security,
  performance,
  features,
} = config;

// Legacy export for backward compatibility
export const cognitoConfig = cognito;

// Development helpers
export const isDevelopment = environment === "development";
export const isStaging = environment === "staging";
export const isProduction = environment === "production";

// Debug configuration in development
if (isDevelopment && typeof window !== "undefined") {
  console.log("App Configuration:", config);

  const validation = validateConfig();
  if (!validation.isValid) {
    console.warn("Configuration validation errors:", validation.errors);
  }
}
