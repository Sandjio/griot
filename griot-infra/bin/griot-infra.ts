#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CoreInfrastructureStack } from "../lib/stacks/core-infrastructure-stack";
import { ApiStack } from "../lib/stacks/api-stack";
import { ProcessingStack } from "../lib/stacks/processing-stack";
import { MonitoringStack } from "../lib/stacks/monitoring-stack";
import {
  loadEnvironmentConfig,
  EnvironmentConfig,
} from "../lib/config/environment-config";

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext("environment") || "dev";
const deploymentColor = app.node.tryGetContext("deploymentColor") || "";
const deploymentId = app.node.tryGetContext("deploymentId") || "";

// Load environment-specific configuration
let envConfig: EnvironmentConfig;
try {
  envConfig = loadEnvironmentConfig(environment);
} catch (error) {
  console.error(`Failed to load environment configuration: ${error}`);
  process.exit(1);
}

// CDK environment configuration
const cdkEnv = {
  account: envConfig.account || process.env.CDK_DEFAULT_ACCOUNT || undefined,
  region: envConfig.region || process.env.CDK_DEFAULT_REGION || "us-east-1",
};

// Stack naming with deployment color for blue-green deployments
const getStackName = (baseName: string) => {
  const colorSuffix = deploymentColor ? `-${deploymentColor}` : "";
  return `${baseName}-${environment}${colorSuffix}`;
};

// Core Infrastructure Stack
const coreStack = new CoreInfrastructureStack(
  app,
  getStackName("GriotCoreStack"),
  {
    environment,
    envConfig,
    deploymentColor,
    deploymentId,
    env: cdkEnv,
    description: `Griot Manga Platform Core Infrastructure - ${environment}${
      deploymentColor ? ` (${deploymentColor})` : ""
    }`,
  }
);

// API Stack
const apiStack = new ApiStack(app, getStackName("GriotMangaApiStack"), {
  environment,
  envConfig,
  deploymentColor,
  deploymentId,
  mangaTable: coreStack.mangaTable,
  contentBucket: coreStack.contentBucket,
  eventBus: coreStack.eventBus,
  securityConstruct: coreStack.securityConstruct,
  env: cdkEnv,
  description: `Griot Manga Platform API - ${environment}${
    deploymentColor ? ` (${deploymentColor})` : ""
  }`,
});

// Processing Stack
const processingStack = new ProcessingStack(
  app,
  getStackName("GriotMangaProcessingStack"),
  {
    environment,
    envConfig,
    deploymentColor,
    deploymentId,
    mangaTable: coreStack.mangaTable,
    contentBucket: coreStack.contentBucket,
    eventBus: coreStack.eventBus,
    eventBridgeConstruct: coreStack.eventBridgeConstruct,
    securityConstruct: coreStack.securityConstruct,
    env: cdkEnv,
    description: `Griot Manga Platform Processing - ${environment}${
      deploymentColor ? ` (${deploymentColor})` : ""
    }`,
  }
);

// Monitoring Stack
const monitoringStack = new MonitoringStack(
  app,
  getStackName("GriotMangaMonitoringStack"),
  {
    environment,
    envConfig,
    deploymentColor,
    deploymentId,
    mangaTable: coreStack.mangaTable,
    contentBucket: coreStack.contentBucket,
    api: apiStack.api,
    eventBus: coreStack.eventBus,
    lambdaFunctions: {
      postAuthTrigger: apiStack.lambdaFunctions.postAuthTrigger,
      preferencesProcessing: apiStack.lambdaFunctions.preferencesProcessing,
      storyGeneration: processingStack.lambdaFunctions.storyGeneration,
      episodeGeneration: processingStack.lambdaFunctions.episodeGeneration,
      imageGeneration: processingStack.lambdaFunctions.imageGeneration,
      contentRetrieval: apiStack.lambdaFunctions.contentRetrieval,
      statusCheck: apiStack.lambdaFunctions.statusCheck,
    },
    alertEmail: envConfig.alertEmail,
    env: cdkEnv,
    description: `Griot Manga Platform Monitoring - ${environment}${
      deploymentColor ? ` (${deploymentColor})` : ""
    }`,
  }
);

// Add dependencies
apiStack.addDependency(coreStack);
processingStack.addDependency(coreStack);
monitoringStack.addDependency(coreStack);
monitoringStack.addDependency(apiStack);
monitoringStack.addDependency(processingStack);

// Note: EventBridge targets are configured directly in the ProcessingStack to avoid circular dependencies

// Tags for all stacks
cdk.Tags.of(app).add("Project", "MangaPlatform");
cdk.Tags.of(app).add("Environment", environment);
cdk.Tags.of(app).add("ManagedBy", "CDK");
if (deploymentColor) {
  cdk.Tags.of(app).add("DeploymentColor", deploymentColor);
}
if (deploymentId) {
  cdk.Tags.of(app).add("DeploymentId", deploymentId);
}
