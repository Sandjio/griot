import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";

export interface CoreInfrastructureStackProps extends cdk.StackProps {
  environment: string;
}

export class CoreInfrastructureStack extends cdk.Stack {
  public readonly mangaTable: dynamodb.Table;
  public readonly contentBucket: s3.Bucket;
  public readonly eventBus: events.EventBus;

  constructor(
    scope: Construct,
    id: string,
    props: CoreInfrastructureStackProps
  ) {
    super(scope, id, props);

    // DynamoDB Single Table Design
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
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      deletionProtection: props.environment === "prod",
      removalPolicy:
        props.environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

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

    // S3 Bucket for content storage
    this.contentBucket = new s3.Bucket(this, "ContentBucket", {
      bucketName: `manga-platform-content-${props.environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: "DeleteIncompleteMultipartUploads",
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: "TransitionToIA",
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
      removalPolicy:
        props.environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // EventBridge Custom Bus
    this.eventBus = new events.EventBus(this, "MangaEventBus", {
      eventBusName: `manga-platform-events-${props.environment}`,
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
  }
}
