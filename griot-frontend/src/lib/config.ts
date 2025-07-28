import { EnvironmentConfig } from "@/types";

// Environment configuration with validation
export const config: EnvironmentConfig = {
  NEXT_PUBLIC_COGNITO_USER_POOL_ID:
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  NEXT_PUBLIC_COGNITO_CLIENT_ID:
    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
  NEXT_PUBLIC_COGNITO_DOMAIN: process.env.NEXT_PUBLIC_COGNITO_DOMAIN || "",
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "",
  NEXT_PUBLIC_ENVIRONMENT:
    (process.env.NEXT_PUBLIC_ENVIRONMENT as
      | "development"
      | "staging"
      | "production") || "development",
  NEXT_PUBLIC_APP_URL:
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
};

// Validate required environment variables
export function validateConfig(): void {
  const requiredVars = [
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID",
    "NEXT_PUBLIC_COGNITO_CLIENT_ID",
    "NEXT_PUBLIC_COGNITO_DOMAIN",
    "NEXT_PUBLIC_API_BASE_URL",
  ] as const;

  const missingVars = requiredVars.filter((varName) => !config[varName]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}\n` +
        "Please check your .env.local file and ensure all required variables are set."
    );
  }
}

// Cognito configuration derived from environment
export const cognitoConfig = {
  userPoolId: config.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  clientId: config.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  domain: config.NEXT_PUBLIC_COGNITO_DOMAIN,
  redirectUri: `${config.NEXT_PUBLIC_APP_URL}/callback`,
  logoutUri: `${config.NEXT_PUBLIC_APP_URL}/`,
  scopes: ["openid", "email", "profile"],
};
