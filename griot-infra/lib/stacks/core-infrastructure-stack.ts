import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { EventBridgeConstruct } from "../constructs/eventbridge-construct";
import { SecurityConstruct } from "../constructs/security-construct";

export interface CoreInfrastructureStackProps extends cdk.StackProps {
  environment: string;
}

export class CoreInfrastructureStack extends cdk.Stack {
  public readonly mangaTable: dynamodb.Table;
  public readonly contentBucket: s3.Bucket;
  public readonly eventBus: events.EventBus;
  public readonly eventBridgeConstruct: EventBridgeConstruct;
  public readonly securityConstruct: SecurityConstruct;
  public readonly s3AccessPolicy: iam.PolicyStatement;

  constructor(
    scope: Construct,
    id: string,
    props: CoreInfrastructureStackProps
  ) {
    super(scope, id, props);

    // DynamoDB Single Table Design with enhanced encryption
    this.mangaTable = new dynamodb.Table(this, "MangaPlatformTable", {
      tableName: `manga-platform-table-${props.environment}`,
      partitionKey: {
        name: "PK",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "SK",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Enhanced encryption configuration
      encryption:
        props.environment === "prod"
          ? dynamodb.TableEncryption.CUSTOMER_MANAGED
          : dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      deletionProtection: props.environment === "prod",
      removalPolicy:
        props.environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      // Additional security configurations
    });

    // Contributor Insights cannot be enabled via CDK directly; consider enabling it manually in the AWS Console if needed.
    // if (props.environment === "prod") {
    //   this.mangaTable.enableContributorInsights();
    // }

    // Global Secondary Index 1 - Alternative access patterns
    this.mangaTable.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: {
        name: "GSI1PK",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "GSI1SK",
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Global Secondary Index 2 - Status-based queries
    this.mangaTable.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: {
        name: "GSI2PK",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "GSI2SK",
        type: dynamodb.AttributeType.STRING,
      },
    });

    // S3 Bucket for content storage with enhanced encryption and security
    this.contentBucket = new s3.Bucket(this, "ContentBucket", {
      bucketName: `manga-platform-content-${props.environment}`,
      // Enhanced encryption configuration
      encryption:
        props.environment === "prod"
          ? s3.BucketEncryption.KMS_MANAGED
          : s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      // Enhanced security configurations
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ["*"], // Configure specific origins in production
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: "DeleteIncompleteMultipartUploads",
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: "TransitionToIA",
          prefix: "stories/",
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
        {
          id: "TransitionEpisodesToIA",
          prefix: "episodes/",
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
        {
          id: "TransitionImagesToIA",
          prefix: "images/",
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(60),
            },
          ],
        },
        {
          id: "DeleteOldVersions",
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy:
        props.environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.environment !== "prod",
    });

    // EventBridge Custom Bus
    this.eventBus = new events.EventBus(this, "MangaEventBus", {
      eventBusName: `manga-platform-events-${props.environment}`,
    });

    // EventBridge Construct with rules, targets, and DLQs
    this.eventBridgeConstruct = new EventBridgeConstruct(
      this,
      "EventBridgeConstruct",
      {
        eventBus: this.eventBus,
        environment: props.environment,
      }
    );

    // Security Construct with IAM roles and policies
    this.securityConstruct = new SecurityConstruct(this, "SecurityConstruct", {
      environment: props.environment,
      mangaTable: this.mangaTable,
      contentBucket: this.contentBucket,
      eventBus: this.eventBus,
    });

    // S3 Access Policy for Lambda functions
    this.s3AccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetObjectVersion",
        "s3:PutObjectAcl",
        "s3:GetObjectAcl",
      ],
      resources: [
        this.contentBucket.bucketArn,
        `${this.contentBucket.bucketArn}/*`,
      ],
    });

    // Output important ARNs for cross-stack references
    new cdk.CfnOutput(this, "MangaTableArn", {
      value: this.mangaTable.tableArn,
      exportName: `manga-table-arn-${props.environment}`,
    });

    new cdk.CfnOutput(this, "ContentBucketArn", {
      value: this.contentBucket.bucketArn,
      exportName: `content-bucket-arn-${props.environment}`,
    });

    new cdk.CfnOutput(this, "EventBusArn", {
      value: this.eventBus.eventBusArn,
      exportName: `event-bus-arn-${props.environment}`,
    });

    new cdk.CfnOutput(this, "ContentBucketName", {
      value: this.contentBucket.bucketName,
      exportName: `content-bucket-name-${props.environment}`,
    });
  }
}
