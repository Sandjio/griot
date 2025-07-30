import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { SecurityConstruct } from "../constructs/security-construct";
import { LambdaMonitoringConstruct } from "../constructs/lambda-monitoring-construct";
import { EnvironmentConfig } from "../config/environment-config";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../../..", ".env") });

export interface ApiStackProps extends cdk.StackProps {
  environment: string;
  envConfig: EnvironmentConfig;
  deploymentColor?: string;
  deploymentId?: string;
  mangaTable: dynamodb.Table;
  contentBucket: s3.Bucket;
  eventBus: events.EventBus;
  securityConstruct: SecurityConstruct;
  vpc?: ec2.Vpc;
}

export class ApiStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly api: apigateway.RestApi;
  public readonly postAuthTrigger: lambda.Function;
  public readonly securityConstruct: SecurityConstruct;
  public readonly lambdaFunctions: { [key: string]: lambda.Function } = {};

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Use Security Construct from props
    this.securityConstruct = props.securityConstruct;

    // Cognito User Pool with comprehensive security policies
    this.userPool = new cognito.UserPool(this, "GriotMangaUserPool", {
      userPoolName: `griot-manga-platform-users-${props.environment}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      signInCaseSensitive: false,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // MFA Configuration
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      // Account lockout policies
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: true,
      },
      // Basic security features (advanced security requires Plus plan)
      // User verification
      userVerification: {
        emailSubject: "Griot Manga Platform - Verify your email",
        emailBody:
          "Thank you for signing up to Griot Manga Platform! Your verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
        // smsMessage: "Your Manga Platform verification code is {####}", // For now we skip SMS verification
      },
      // User invitation
      userInvitation: {
        emailSubject: "Welcome to Griot Manga Platform",
        emailBody:
          "Hello {username}, you have been invited to join Manga Platform. Your temporary password is {####}",
        // smsMessage:
        //   "Hello {username}, your temporary Manga Platform password is {####}", // For now we skip SMS invitation
      },
      // Email configuration
      email: cognito.UserPoolEmail.withCognito(),
      // Deletion protection
      deletionProtection: props.environment === "prod",
      removalPolicy:
        props.environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });
    // Managed UI domain for Cognito User Pool
    this.userPool.addDomain("GriotMangaDomain", {
      cognitoDomain: {
        domainPrefix: `griot-manga-${props.environment}`,
      },
    });

    // Post Authentication Trigger Lambda with user profile creation
    this.postAuthTrigger = new NodejsFunction(this, "PostAuthTrigger", {
      functionName: `manga-post-auth-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      entry: path.join(
        __dirname,
        "../../..",
        "/src/lambdas/post-auth-trigger/index.ts"
      ),
      role: this.securityConstruct.postAuthTriggerRole,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
        externalModules: ["aws-sdk"],
      },
      projectRoot: path.join(__dirname, "../../.."),
      environment: {
        MANGA_TABLE_NAME: props.mangaTable.tableName,
        ENVIRONMENT: props.environment,
        // Security-related environment variables
        ENABLE_SECURITY_LOGGING: "true",
        SECURITY_CONTEXT: "postAuth",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      // Enable X-Ray tracing
      tracing: lambda.Tracing.ACTIVE,
      // VPC configuration if provided
      ...(props.vpc
        ? {
            vpc: props.vpc,
            vpcSubnets: {
              subnets: props.vpc.privateSubnets,
            },
          }
        : {}),
    });

    // Store Lambda function reference
    this.lambdaFunctions.postAuthTrigger = this.postAuthTrigger;

    // Add Post Authentication trigger to User Pool
    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_AUTHENTICATION,
      this.postAuthTrigger
    );

    // User Pool Client with enhanced JWT token validation
    this.userPoolClient = new cognito.UserPoolClient(
      this,
      "GriotMangaUserPoolClient",
      {
        userPool: this.userPool,
        userPoolClientName: `manga-platform-client-${props.environment}`,
        generateSecret: false,
        authFlows: {
          userPassword: true,
          userSrp: true,
          adminUserPassword: false, // Disable admin auth flow for security
          custom: false, // Disable custom auth flow
        },
        // JWT token configuration
        accessTokenValidity: cdk.Duration.hours(1), // Short-lived access tokens
        idTokenValidity: cdk.Duration.hours(1), // Short-lived ID tokens
        refreshTokenValidity: cdk.Duration.days(30), // Longer refresh token validity
        // Token revocation
        enableTokenRevocation: true,
        // Prevent user existence errors
        preventUserExistenceErrors: true,
        // OAuth configuration
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
            implicitCodeGrant: false, // Disable implicit flow for security
          },
          scopes: [
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.PROFILE,
          ],
          callbackUrls: [
            // Add callback URLs based on environment
            props.environment === "prod"
              ? "https://griot.emmasandjio.com/callback"
              : "http://localhost:3000/callback",
          ],
          logoutUrls: [
            props.environment === "prod"
              ? "https://griot.emmasandjio.com/logout"
              : "http://localhost:3000/logout",
          ],
        },
        // Read and write attributes
        readAttributes: new cognito.ClientAttributes().withStandardAttributes({
          email: true,
          emailVerified: true,
          preferredUsername: true,
        }),
        writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
          email: true,
          preferredUsername: true,
        }),
      }
    );

    // API Gateway with enhanced configuration
    this.api = new apigateway.RestApi(this, "GriotMangaApi", {
      restApiName: `griot-manga-platform-api-${props.environment}`,
      description: "Griot Manga Generation Platform API",
      // CORS configuration for frontend integration
      defaultCorsPreflightOptions: {
        allowOrigins:
          props.environment === "prod"
            ? ["https://griot.emmasandjio.com"]
            : apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
          "X-Requested-With",
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.hours(1),
      },
      // Enhanced deployment configuration
      deployOptions: {
        stageName: props.environment,
        // Comprehensive logging configuration
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        // Request/response logging
        accessLogDestination: new apigateway.LogGroupLogDestination(
          new logs.LogGroup(this, "ApiAccessLogs", {
            logGroupName: `/aws/apigateway/manga-platform-${props.environment}`,
            retention:
              props.environment === "prod"
                ? logs.RetentionDays.ONE_MONTH
                : logs.RetentionDays.ONE_WEEK,
            removalPolicy:
              props.environment === "prod"
                ? cdk.RemovalPolicy.RETAIN
                : cdk.RemovalPolicy.DESTROY,
          })
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
      // API Gateway policy for additional security
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: ["*"],
            // Add IP restrictions for production if needed
            ...(props.environment === "prod"
              ? {
                  conditions: {
                    IpAddress: {
                      "aws:SourceIp": [
                        // Add specific IP ranges for production if needed
                        "0.0.0.0/0",
                      ],
                    },
                  },
                }
              : {}),
          }),
        ],
      }),
      // Enable binary media types for file uploads/downloads
      binaryMediaTypes: [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/jpg",
        "application/octet-stream",
      ],
    });

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "MangaAuthorizer",
      {
        cognitoUserPools: [this.userPool],
        authorizerName: `manga-authorizer-${props.environment}`,
      }
    );

    // Request Validators for input validation
    const requestValidator = this.api.addRequestValidator("RequestValidator", {
      requestValidatorName: `manga-request-validator-${props.environment}`,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    // API Models for request/response validation
    const preferencesRequestModel = this.api.addModel(
      "PreferencesRequestModel",
      {
        modelName: "PreferencesRequest",
        contentType: "application/json",
        schema: {
          type: apigateway.JsonSchemaType.OBJECT,
          properties: {
            genres: {
              type: apigateway.JsonSchemaType.ARRAY,
              items: {
                type: apigateway.JsonSchemaType.STRING,
              },
              minItems: 1,
              maxItems: 10,
            },
            themes: {
              type: apigateway.JsonSchemaType.ARRAY,
              items: {
                type: apigateway.JsonSchemaType.STRING,
              },
              minItems: 1,
              maxItems: 10,
            },
            artStyle: {
              type: apigateway.JsonSchemaType.STRING,
              enum: [
                "Traditional",
                "Modern",
                "Minimalist",
                "Detailed",
                "Cartoon",
                "Realistic",
                "Chibi",
                "Dark",
                "Colorful",
                "Black and White",
              ],
            },
            targetAudience: {
              type: apigateway.JsonSchemaType.STRING,
              enum: ["Children", "Teens", "Young Adults", "Adults", "All Ages"],
            },
            contentRating: {
              type: apigateway.JsonSchemaType.STRING,
              enum: ["G", "PG", "PG-13", "R"],
            },
          },
          required: [
            "genres",
            "themes",
            "artStyle",
            "targetAudience",
            "contentRating",
          ],
          additionalProperties: false,
        },
      }
    );

    const errorResponseModel = this.api.addModel("ErrorResponseModel", {
      modelName: "ErrorResponse",
      contentType: "application/json",
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          error: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              code: {
                type: apigateway.JsonSchemaType.STRING,
              },
              message: {
                type: apigateway.JsonSchemaType.STRING,
              },
              details: {
                type: apigateway.JsonSchemaType.OBJECT,
              },
              requestId: {
                type: apigateway.JsonSchemaType.STRING,
              },
              timestamp: {
                type: apigateway.JsonSchemaType.STRING,
              },
            },
            required: ["code", "message", "requestId", "timestamp"],
          },
        },
        required: ["error"],
      },
    });

    const successResponseModel = this.api.addModel("SuccessResponseModel", {
      modelName: "SuccessResponse",
      contentType: "application/json",
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          success: {
            type: apigateway.JsonSchemaType.BOOLEAN,
          },
          message: {
            type: apigateway.JsonSchemaType.STRING,
          },
          data: {
            type: apigateway.JsonSchemaType.OBJECT,
          },
          requestId: {
            type: apigateway.JsonSchemaType.STRING,
          },
          timestamp: {
            type: apigateway.JsonSchemaType.STRING,
          },
        },
        required: ["success", "message", "requestId", "timestamp"],
      },
    });

    const preferencesGetResponseModel = this.api.addModel(
      "PreferencesGetResponseModel",
      {
        modelName: "PreferencesGetResponse",
        contentType: "application/json",
        schema: {
          type: apigateway.JsonSchemaType.OBJECT,
          properties: {
            success: {
              type: apigateway.JsonSchemaType.BOOLEAN,
            },
            data: {
              type: apigateway.JsonSchemaType.OBJECT,
              properties: {
                preferences: {
                  oneOf: [
                    {
                      type: apigateway.JsonSchemaType.NULL,
                    },
                    {
                      type: apigateway.JsonSchemaType.OBJECT,
                      properties: {
                        genres: {
                          type: apigateway.JsonSchemaType.ARRAY,
                          items: {
                            type: apigateway.JsonSchemaType.STRING,
                          },
                        },
                        themes: {
                          type: apigateway.JsonSchemaType.ARRAY,
                          items: {
                            type: apigateway.JsonSchemaType.STRING,
                          },
                        },
                        artStyle: {
                          type: apigateway.JsonSchemaType.STRING,
                        },
                        targetAudience: {
                          type: apigateway.JsonSchemaType.STRING,
                        },
                        contentRating: {
                          type: apigateway.JsonSchemaType.STRING,
                        },
                      },
                      required: [
                        "genres",
                        "themes",
                        "artStyle",
                        "targetAudience",
                        "contentRating",
                      ],
                    },
                  ],
                },
                insights: {
                  type: apigateway.JsonSchemaType.OBJECT,
                },
                lastUpdated: {
                  type: apigateway.JsonSchemaType.STRING,
                },
                message: {
                  type: apigateway.JsonSchemaType.STRING,
                },
              },
              required: ["preferences"],
            },
            requestId: {
              type: apigateway.JsonSchemaType.STRING,
            },
            timestamp: {
              type: apigateway.JsonSchemaType.STRING,
            },
          },
          required: ["success", "data", "requestId", "timestamp"],
        },
      }
    );

    // Preferences Processing Lambda function with security configuration
    const preferencesLambda = new NodejsFunction(this, "PreferencesLambda", {
      functionName: `manga-preferences-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler",
      entry: path.join(
        __dirname,
        "../../..",
        "/src/lambdas/preferences-processing/index.ts"
      ),
      role: this.securityConstruct.preferencesProcessingRole,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
        externalModules: ["aws-sdk"],
      },
      projectRoot: path.join(__dirname, "../../.."),
      environment: {
        MANGA_TABLE_NAME: props.mangaTable.tableName,
        CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
        ENVIRONMENT: props.environment,
        QLOO_API_KEY: process.env.QLOO_API_KEY!,
        QLOO_API_URL: process.env.QLOO_API_URL!,
        // Security-related environment variables
        ENABLE_SECURITY_LOGGING: "true",
        SECURITY_CONTEXT: "preferences",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      // Enable X-Ray tracing
      tracing: lambda.Tracing.ACTIVE,
      // VPC configuration if provided
      ...(props.vpc
        ? {
            vpc: props.vpc,
            vpcSubnets: {
              subnets: props.vpc.privateSubnets,
            },
          }
        : {}),
    });

    // Status Check Lambda function with security configuration
    const statusCheckLambda = new lambda.Function(this, "StatusCheckLambda", {
      functionName: `manga-status-check-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("../src/lambdas/status-check"),
      role: this.securityConstruct.statusCheckRole,
      environment: {
        MANGA_TABLE_NAME: props.mangaTable.tableName,
        ENVIRONMENT: props.environment,
        // Security-related environment variables
        ENABLE_SECURITY_LOGGING: "true",
        SECURITY_CONTEXT: "statusCheck",
      },
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      // Enable X-Ray tracing
      tracing: lambda.Tracing.ACTIVE,
      // VPC configuration if provided
      ...(props.vpc
        ? {
            vpc: props.vpc,
            vpcSubnets: {
              subnets: props.vpc.privateSubnets,
            },
          }
        : {}),
    });

    // Health Check Lambda function
    const healthCheckLambda = new lambda.Function(this, "HealthCheckLambda", {
      functionName: `manga-health-check-${props.environment}${
        props.deploymentColor ? `-${props.deploymentColor}` : ""
      }`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("../src/lambdas/health-check"),
      timeout: cdk.Duration.seconds(30),
      memorySize: props.envConfig.lambdaSettings.memorySize,
      environment: {
        ENVIRONMENT: props.environment,
        DEPLOYMENT_COLOR: props.deploymentColor || "",
        DEPLOYMENT_VERSION: props.deploymentId || "1.0.0",
        LOG_LEVEL: props.environment === "prod" ? "INFO" : "DEBUG",
      },
      logRetention: props.envConfig.logRetentionDays as logs.RetentionDays,
      tracing: props.envConfig.enableXRayTracing
        ? lambda.Tracing.ACTIVE
        : lambda.Tracing.DISABLED,
    });

    // Store Lambda function references
    this.lambdaFunctions.preferencesProcessing = preferencesLambda;
    this.lambdaFunctions.statusCheck = statusCheckLambda;
    this.lambdaFunctions.healthCheck = healthCheckLambda;

    // API Resources and Methods with request validation

    // Health endpoint (no authentication required)
    const healthResource = this.api.root.addResource("health");
    healthResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(healthCheckLambda, {
        proxy: true,
      }),
      {
        // No authorization required for health checks
        authorizationType: apigateway.AuthorizationType.NONE,
      }
    );

    const preferencesResource = this.api.root.addResource("preferences");

    // POST method for creating/updating preferences
    preferencesResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(preferencesLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": "",
            },
          },
          {
            statusCode: "400",
            selectionPattern: "4\\d{2}",
            responseTemplates: {
              "application/json": JSON.stringify({
                error: {
                  code: "VALIDATION_ERROR",
                  message: "Invalid request format",
                  requestId: "$context.requestId",
                  timestamp: "$context.requestTime",
                },
              }),
            },
          },
          {
            statusCode: "500",
            selectionPattern: "5\\d{2}",
            responseTemplates: {
              "application/json": JSON.stringify({
                error: {
                  code: "INTERNAL_ERROR",
                  message: "Internal server error",
                  requestId: "$context.requestId",
                  timestamp: "$context.requestTime",
                },
              }),
            },
          },
        ],
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
        requestModels: {
          "application/json": preferencesRequestModel,
        },
        methodResponses: [
          {
            statusCode: "200",
            responseModels: {
              "application/json": successResponseModel,
            },
          },
          {
            statusCode: "400",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "401",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "500",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
        ],
      }
    );

    // GET method for retrieving preferences
    preferencesResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(preferencesLambda, {
        proxy: true,
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: "200",
            responseModels: {
              "application/json": preferencesGetResponseModel,
            },
          },
          {
            statusCode: "401",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "404",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "500",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
        ],
      }
    );

    const storiesResource = this.api.root.addResource("stories");
    const storyResource = storiesResource.addResource("{storyId}");
    const episodesResource = this.api.root.addResource("episodes");
    const episodeResource = episodesResource.addResource("{episodeId}");
    const statusResource = this.api.root.addResource("status");
    const statusRequestResource = statusResource.addResource("{requestId}");

    // Content Retrieval Lambda function with security configuration
    const contentRetrievalLambda = new lambda.Function(
      this,
      "ContentRetrievalLambda",
      {
        functionName: `manga-content-retrieval-${props.environment}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("../src/lambdas/content-retrieval"),
        role: this.securityConstruct.contentRetrievalRole,
        environment: {
          MANGA_TABLE_NAME: props.mangaTable.tableName,
          CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
          ENVIRONMENT: props.environment,
          // Security-related environment variables
          ENABLE_SECURITY_LOGGING: "true",
          SECURITY_CONTEXT: "contentRetrieval",
        },
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        // Enable X-Ray tracing
        tracing: lambda.Tracing.ACTIVE,
        // VPC configuration if provided
        ...(props.vpc
          ? {
              vpc: props.vpc,
              vpcSubnets: {
                subnets: props.vpc.privateSubnets,
              },
            }
          : {}),
      }
    );

    // Store Lambda function reference
    this.lambdaFunctions.contentRetrieval = contentRetrievalLambda;

    // Add methods with proper validation and response models
    storiesResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(contentRetrievalLambda, {
        proxy: true,
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          "method.request.querystring.limit": false,
          "method.request.querystring.offset": false,
          "method.request.querystring.status": false,
        },
        methodResponses: [
          {
            statusCode: "200",
            responseModels: {
              "application/json": successResponseModel,
            },
          },
          {
            statusCode: "401",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "500",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
        ],
      }
    );

    storyResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(contentRetrievalLambda, {
        proxy: true,
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          "method.request.path.storyId": true,
        },
        methodResponses: [
          {
            statusCode: "200",
            responseModels: {
              "application/json": successResponseModel,
            },
          },
          {
            statusCode: "401",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "404",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "500",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
        ],
      }
    );

    episodeResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(contentRetrievalLambda, {
        proxy: true,
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          "method.request.path.episodeId": true,
        },
        methodResponses: [
          {
            statusCode: "200",
            responseModels: {
              "application/json": successResponseModel,
            },
          },
          {
            statusCode: "401",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "404",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "500",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
        ],
      }
    );

    statusRequestResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(statusCheckLambda, {
        proxy: true,
      }),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          "method.request.path.requestId": true,
        },
        methodResponses: [
          {
            statusCode: "200",
            responseModels: {
              "application/json": successResponseModel,
            },
          },
          {
            statusCode: "401",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "404",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
          {
            statusCode: "500",
            responseModels: {
              "application/json": errorResponseModel,
            },
          },
        ],
      }
    );

    // Outputs
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: `user-pool-id-${props.environment}`,
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      exportName: `user-pool-client-id-${props.environment}`,
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      exportName: `api-url-${props.environment}`,
    });

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: this.api.url,
      exportName: `api-endpoint-${props.environment}`,
    });

    new cdk.CfnOutput(this, "ApiName", {
      value: this.api.restApiName,
      exportName: `api-name-${props.environment}`,
    });
  }
}
