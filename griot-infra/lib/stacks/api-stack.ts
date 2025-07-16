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

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, "MangaUserPool", {
      userPoolName: `manga-platform-users-${props.environment}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy:
        props.environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // Post Authentication Trigger Lambda (placeholder)
    this.postAuthTrigger = new lambda.Function(this, "PostAuthTrigger", {
      functionName: `manga-post-auth-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Post Authentication Trigger:', JSON.stringify(event, null, 2));
          // TODO: Implement user profile creation logic
          return event;
        };
      `),
      environment: {
        MANGA_TABLE_NAME: props.mangaTable.tableName,
        ENVIRONMENT: props.environment,
      },
    });

    // Grant DynamoDB permissions to Post Auth trigger
    props.mangaTable.grantWriteData(this.postAuthTrigger);

    // Add Post Authentication trigger to User Pool
    this.userPool.addTrigger(
      cognito.UserPoolOperation.POST_AUTHENTICATION,
      this.postAuthTrigger
    );

    // User Pool Client
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
        },
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
          },
          scopes: [
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.PROFILE,
          ],
        },
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
