#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CoreInfrastructureStack } from "../lib/stacks/core-infrastructure-stack";
import { ApiStack } from "../lib/stacks/api-stack";
import { ProcessingStack } from "../lib/stacks/processing-stack";
import { MonitoringStack } from "../lib/stacks/monitoring-stack";

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext("environment") || "dev";

// Get environment-specific configuration
const environments = app.node.tryGetContext("environments") || {};
const envSettings = environments[environment] || {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  alertEmail: undefined,
};

// Environment configuration - make it optional for synthesis
const envConfig = {
  account: envSettings.account || process.env.CDK_DEFAULT_ACCOUNT || undefined,
  region: envSettings.region || process.env.CDK_DEFAULT_REGION || "us-east-1",
};

const alertEmail = envSettings.alertEmail;

// Core Infrastructure Stack
const coreStack = new CoreInfrastructureStack(
  app,
  `GriotCoreStack-${environment}`,
  {
    environment,
    env: envConfig,
    description: `Griot Manga Platform Core Infrastructure - ${environment}`,
  }
);

// API Stack
const apiStack = new ApiStack(app, `GriotMangaApiStack-${environment}`, {
  environment,
  mangaTable: coreStack.mangaTable,
  contentBucket: coreStack.contentBucket,
  eventBus: coreStack.eventBus,
  securityConstruct: coreStack.securityConstruct,
  env: envConfig,
  description: `Griot Manga Platform API - ${environment}`,
});

// Processing Stack
const processingStack = new ProcessingStack(
  app,
  `GriotMangaProcessingStack-${environment}`,
  {
    environment,
    mangaTable: coreStack.mangaTable,
    contentBucket: coreStack.contentBucket,
    eventBus: coreStack.eventBus,
    eventBridgeConstruct: coreStack.eventBridgeConstruct,
    securityConstruct: coreStack.securityConstruct,
    env: envConfig,
    description: `Griot Manga Platform Processing - ${environment}`,
  }
);

// Monitoring Stack - temporarily disabled to resolve circular dependencies
// const monitoringStack = new MonitoringStack(
//   app,
//   `GriotMangaMonitoringStack-${environment}`,
//   {
//     environment,
//     mangaTable: coreStack.mangaTable,
//     contentBucket: coreStack.contentBucket,
//     api: apiStack.api,
//     eventBus: coreStack.eventBus,
//     lambdaFunctions: {
//       postAuthTrigger: apiStack.lambdaFunctions.postAuthTrigger,
//       preferencesProcessing: apiStack.lambdaFunctions.preferencesProcessing,
//       storyGeneration: processingStack.lambdaFunctions.storyGeneration,
//       episodeGeneration: processingStack.lambdaFunctions.episodeGeneration,
//       imageGeneration: processingStack.lambdaFunctions.imageGeneration,
//       contentRetrieval: apiStack.lambdaFunctions.contentRetrieval,
//       statusCheck: apiStack.lambdaFunctions.statusCheck,
//     },
//     alertEmail,
//     env: envConfig,
//     description: `Griot Manga Platform Monitoring - ${environment}`,
//   }
// );

// Add dependencies
apiStack.addDependency(coreStack);
processingStack.addDependency(coreStack);
// monitoringStack.addDependency(coreStack);
// monitoringStack.addDependency(apiStack);
// monitoringStack.addDependency(processingStack);

// Tags for all stacks
cdk.Tags.of(app).add("Project", "MangaPlatform");
cdk.Tags.of(app).add("Environment", environment);
cdk.Tags.of(app).add("ManagedBy", "CDK");
