import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";

export interface ApiStackProps extends cdk.StackProps {
  environment: string;
  mangaTable: dynamodb.Table;
  contentBucket: s3.Bucket;
  eventBus: events.EventBus;
}

export class ApiStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly api: apigateway.RestApi;
  public readonly postAuthTrigger: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Cognito User Pool with comprehensive security policies
    this.userPool = new cognito.UserPool(this, "MangaUserPool", {
      userPoolName: `manga-platform-users-${props.environment}`,
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
      // Advanced security features
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      // User verification
      userVerification: {
        emailSubject: "Manga Platform - Verify your email",
        emailBody:
          "Thank you for signing up to Manga Platform! Your verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
        smsMessage: "Your Manga Platform verification code is {####}",
      },
      // User invitation
      userInvitation: {
        emailSubject: "Welcome to Manga Platform",
        emailBody:
          "Hello {username}, you have been invited to join Manga Platform. Your temporary password is {####}",
        smsMessage:
          "Hello {username}, your temporary Manga Platform password is {####}",
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

    // Post Authentication Trigger Lambda with user profile creation
    this.postAuthTrigger = new lambda.Function(this, "PostAuthTrigger", {
      functionName: `manga-post-auth-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("../src/lambdas/post-auth-trigger"),
      environment: {
        MANGA_TABLE_NAME: props.mangaTable.tableName,
        ENVIRONMENT: props.environment,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    // Grant DynamoDB permissions to Post Auth trigger
    props.mangaTable.grantReadWriteData(this.postAuthTrigger);

    // Add Post Authentication trigger to User Pool
    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_AUTHENTICATION,
      this.postAuthTrigger
    );

    // User Pool Client with enhanced JWT token validation
    this.userPoolClient = new cognito.UserPoolClient(
      this,
      "MangaUserPoolClient",
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
              ? "https://manga-platform.com/callback"
              : "http://localhost:3000/callback",
          ],
          logoutUrls: [
            props.environment === "prod"
              ? "https://manga-platform.com/logout"
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

    // API Gateway
    this.api = new apigateway.RestApi(this, "MangaApi", {
      restApiName: `manga-platform-api-${props.environment}`,
      description: "Manga Generation Platform API",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
        ],
      },
      deployOptions: {
        stageName: props.environment,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
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

    // Placeholder Lambda functions for API endpoints
    const preferencesLambda = new lambda.Function(this, "PreferencesLambda", {
      functionName: `manga-preferences-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Preferences Lambda:', JSON.stringify(event, null, 2));
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Preferences endpoint - TODO: Implement' }),
          };
        };
      `),
      environment: {
        MANGA_TABLE_NAME: props.mangaTable.tableName,
        CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        ENVIRONMENT: props.environment,
      },
    });

    // Grant permissions to preferences lambda
    props.mangaTable.grantReadWriteData(preferencesLambda);
    props.contentBucket.grantReadWrite(preferencesLambda);
    props.eventBus.grantPutEventsTo(preferencesLambda);

    // API Resources and Methods
    const preferencesResource = this.api.root.addResource("preferences");
    preferencesResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(preferencesLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    const storiesResource = this.api.root.addResource("stories");
    const storyResource = storiesResource.addResource("{storyId}");
    const episodesResource = this.api.root.addResource("episodes");
    const episodeResource = episodesResource.addResource("{episodeId}");
    const statusResource = this.api.root.addResource("status");
    const statusRequestResource = statusResource.addResource("{requestId}");

    // Placeholder responses for other endpoints
    const placeholderLambda = new lambda.Function(this, "PlaceholderLambda", {
      functionName: `manga-placeholder-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          const path = event.requestContext.resourcePath;
          const method = event.httpMethod;
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ 
              message: \`\${method} \${path} - TODO: Implement\`,
              path,
              method
            }),
          };
        };
      `),
    });

    // Add placeholder methods
    storiesResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(placeholderLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    storyResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(placeholderLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    episodeResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(placeholderLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    statusRequestResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(placeholderLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
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
  }
}
