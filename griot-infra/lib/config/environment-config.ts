import * as fs from "fs";
import * as path from "path";

export interface EnvironmentConfig {
  environment: string;
  region: string;
  account: string;
  alertEmail: string;
  domainName: string;
  certificateArn: string;
  enableXRayTracing: boolean;
  logRetentionDays: number;
  backupRetentionDays: number;
  enableDetailedMonitoring: boolean;
  lambdaSettings: {
    timeout: number;
    memorySize: number;
    reservedConcurrency: number;
  };
  dynamoDbSettings: {
    billingMode: "PAY_PER_REQUEST" | "PROVISIONED";
    readCapacity?: number;
    writeCapacity?: number;
    pointInTimeRecovery: boolean;
    deletionProtection: boolean;
  };
  s3Settings: {
    versioning: boolean;
    lifecycleRules: {
      transitionToIA: number;
      transitionToGlacier: number;
      expiration: number;
    };
  };
  apiGatewaySettings: {
    throttling: {
      rateLimit: number;
      burstLimit: number;
    };
    caching: {
      enabled: boolean;
      ttl: number;
    };
  };
  bedrockSettings: {
    models: {
      textGeneration: string;
      imageGeneration: string;
    };
    maxTokens: number;
    temperature: number;
  };
}

export class EnvironmentConfigLoader {
  private static instance: EnvironmentConfigLoader;
  private configCache: Map<string, EnvironmentConfig> = new Map();

  private constructor() {}

  public static getInstance(): EnvironmentConfigLoader {
    if (!EnvironmentConfigLoader.instance) {
      EnvironmentConfigLoader.instance = new EnvironmentConfigLoader();
    }
    return EnvironmentConfigLoader.instance;
  }

  public loadConfig(environment: string): EnvironmentConfig {
    // Check cache first
    if (this.configCache.has(environment)) {
      return this.configCache.get(environment)!;
    }

    const configPath = path.join(
      __dirname,
      "../../config/environments",
      `${environment}.json`
    );

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Configuration file not found for environment: ${environment}`
      );
    }

    try {
      const configContent = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(configContent) as EnvironmentConfig;

      // Replace environment variables
      const processedConfig = this.processEnvironmentVariables(config);

      // Validate configuration
      this.validateConfig(processedConfig);

      // Cache the configuration
      this.configCache.set(environment, processedConfig);

      return processedConfig;
    } catch (error) {
      throw new Error(
        `Failed to load configuration for environment ${environment}: ${error}`
      );
    }
  }

  private processEnvironmentVariables(config: any): any {
    const processedConfig = JSON.parse(JSON.stringify(config));

    const processValue = (value: any): any => {
      if (typeof value === "string") {
        // Replace ${VAR_NAME} with environment variable values
        return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
          return process.env[varName] || match;
        });
      } else if (typeof value === "object" && value !== null) {
        const result: any = Array.isArray(value) ? [] : {};
        for (const key in value) {
          result[key] = processValue(value[key]);
        }
        return result;
      }
      return value;
    };

    return processValue(processedConfig);
  }

  private validateConfig(config: EnvironmentConfig): void {
    const requiredFields = [
      "environment",
      "region",
      "lambdaSettings",
      "dynamoDbSettings",
      "s3Settings",
      "apiGatewaySettings",
      "bedrockSettings",
    ];

    for (const field of requiredFields) {
      if (!config[field as keyof EnvironmentConfig]) {
        throw new Error(`Missing required configuration field: ${field}`);
      }
    }

    // Validate environment values
    if (!["dev", "staging", "prod"].includes(config.environment)) {
      throw new Error(`Invalid environment: ${config.environment}`);
    }

    // Validate DynamoDB billing mode
    if (
      !["PAY_PER_REQUEST", "PROVISIONED"].includes(
        config.dynamoDbSettings.billingMode
      )
    ) {
      throw new Error(
        `Invalid DynamoDB billing mode: ${config.dynamoDbSettings.billingMode}`
      );
    }

    // Validate provisioned capacity settings
    if (config.dynamoDbSettings.billingMode === "PROVISIONED") {
      if (
        !config.dynamoDbSettings.readCapacity ||
        !config.dynamoDbSettings.writeCapacity
      ) {
        throw new Error(
          "Read and write capacity must be specified for PROVISIONED billing mode"
        );
      }
    }
  }

  public getAvailableEnvironments(): string[] {
    const configDir = path.join(__dirname, "../../config/environments");

    if (!fs.existsSync(configDir)) {
      return [];
    }

    return fs
      .readdirSync(configDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(".json", ""));
  }

  public clearCache(): void {
    this.configCache.clear();
  }
}

// Convenience function for loading configuration
export function loadEnvironmentConfig(environment: string): EnvironmentConfig {
  return EnvironmentConfigLoader.getInstance().loadConfig(environment);
}
