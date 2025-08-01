import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface SecurityConstructProps {
  environment: string;
  mangaTable: dynamodb.Table;
  contentBucket: s3.Bucket;
  eventBus: events.EventBus;
  vpc?: ec2.Vpc;
}

/**
 * Security Construct that implements comprehensive security configurations
 * including least-privilege IAM roles, encryption, and VPC endpoints.
 *
 * Requirements: 9.3, 6.6
 */
export class SecurityConstruct extends Construct {
  public readonly lambdaExecutionRole: iam.Role;
  public readonly postAuthTriggerRole: iam.Role;
  public readonly preferencesProcessingRole: iam.Role;
  public readonly storyGenerationRole: iam.Role;
  public readonly episodeGenerationRole: iam.Role;
  public readonly imageGenerationRole: iam.Role;
  public readonly contentRetrievalRole: iam.Role;
  public readonly statusCheckRole: iam.Role;
  public readonly workflowOrchestrationRole: iam.Role;
  public readonly continueEpisodeRole: iam.Role;
  public readonly vpcEndpoints: { [key: string]: ec2.VpcEndpoint } = {};

  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    super(scope, id);

    // Create VPC endpoints for internal service communication if VPC is provided
    // if (props.vpc) {
    //   this.createVpcEndpoints(props.vpc, props.environment);
    // }

    // Create least-privilege IAM roles for each Lambda function
    this.createLambdaRoles(props);

    // Configure resource-based policies
    this.configureResourceBasedPolicies(props);
  }

  /**
   * Create VPC endpoints for secure internal service communication
   */
  // private createVpcEndpoints(vpc: ec2.Vpc, environment: string): void {
  // DynamoDB VPC Endpoint
  // this.vpcEndpoints.dynamodb = new ec2.VpcEndpoint(this, "DynamoDBEndpoint", {
  //   vpc,
  //   service: ec2.VpcEndpointService.DYNAMODB,
  //   vpcEndpointType: ec2.VpcEndpointType.GATEWAY,
  //   routeTableIds: vpc.privateSubnets.map(
  //     (subnet) => subnet.routeTable.routeTableId
  //   ),
  //   policyDocument: new iam.PolicyDocument({
  //     statements: [
  //       new iam.PolicyStatement({
  //         effect: iam.Effect.ALLOW,
  //         principals: [new iam.AnyPrincipal()],
  //         actions: [
  //           "dynamodb:GetItem",
  //           "dynamodb:PutItem",
  //           "dynamodb:UpdateItem",
  //           "dynamodb:DeleteItem",
  //           "dynamodb:Query",
  //           "dynamodb:Scan",
  //           "dynamodb:BatchGetItem",
  //           "dynamodb:BatchWriteItem",
  //         ],
  //         resources: ["*"],
  //         conditions: {
  //           StringEquals: {
  //             "aws:PrincipalTag/Environment": environment,
  //           },
  //         },
  //       }),
  //     ],
  //   }),
  // });

  // S3 VPC Endpoint
  // this.vpcEndpoints.s3 = new ec2.VpcEndpoint(this, "S3Endpoint", {
  //   vpc,
  //   service: ec2.VpcEndpointService.S3,
  //   vpcEndpointType: ec2.VpcEndpointType.GATEWAY,
  //   routeTableIds: vpc.privateSubnets.map(
  //     (subnet) => subnet.routeTable.routeTableId
  //   ),
  //   policyDocument: new iam.PolicyDocument({
  //     statements: [
  //       new iam.PolicyStatement({
  //         effect: iam.Effect.ALLOW,
  //         principals: [new iam.AnyPrincipal()],
  //         actions: [
  //           "s3:GetObject",
  //           "s3:PutObject",
  //           "s3:DeleteObject",
  //           "s3:ListBucket",
  //           "s3:GetObjectVersion",
  //           "s3:PutObjectAcl",
  //           "s3:GetObjectAcl",
  //         ],
  //         resources: ["*"],
  //         conditions: {
  //           StringEquals: {
  //             "aws:PrincipalTag/Environment": environment,
  //           },
  //         },
  //       }),
  //     ],
  //   }),
  // });

  // EventBridge VPC Endpoint
  // this.vpcEndpoints.eventbridge = new ec2.VpcEndpoint(
  //   this,
  //   "EventBridgeEndpoint",
  //   {
  //     vpc,
  //     service: ec2.VpcEndpointService.EVENTBRIDGE,
  //     vpcEndpointType: ec2.VpcEndpointType.INTERFACE,
  //     subnets: {
  //       subnets: vpc.privateSubnets,
  //     },
  //     securityGroups: [this.createVpcEndpointSecurityGroup(vpc, environment)],
  //     policyDocument: new iam.PolicyDocument({
  //       statements: [
  //         new iam.PolicyStatement({
  //           effect: iam.Effect.ALLOW,
  //           principals: [new iam.AnyPrincipal()],
  //           actions: ["events:PutEvents", "events:List*", "events:Describe*"],
  //           resources: ["*"],
  //           conditions: {
  //             StringEquals: {
  //               "aws:PrincipalTag/Environment": environment,
  //             },
  //           },
  //         }),
  //       ],
  //     }),
  //   }
  // );

  // Bedrock VPC Endpoint
  // this.vpcEndpoints.bedrock = new ec2.VpcEndpoint(this, "BedrockEndpoint", {
  //   vpc,
  //   service: new ec2.VpcEndpointService(
  //     `com.amazonaws.${cdk.Stack.of(this).region}.bedrock-runtime`
  //   ),
  //   vpcEndpointType: ec2.VpcEndpointType.INTERFACE,
  //   subnets: {
  //     subnets: vpc.privateSubnets,
  //   },
  //   securityGroups: [this.createVpcEndpointSecurityGroup(vpc, environment)],
  //   policyDocument: new iam.PolicyDocument({
  //     statements: [
  //       new iam.PolicyStatement({
  //         effect: iam.Effect.ALLOW,
  //         principals: [new iam.AnyPrincipal()],
  //         actions: [
  //           "bedrock:InvokeModel",
  //           "bedrock:InvokeModelWithResponseStream",
  //         ],
  //         resources: ["*"],
  //         conditions: {
  //           StringEquals: {
  //             "aws:PrincipalTag/Environment": environment,
  //           },
  //         },
  //       }),
  //     ],
  //   }),
  // });

  // CloudWatch Logs VPC Endpoint
  // this.vpcEndpoints.logs = new ec2.VpcEndpoint(this, "LogsEndpoint", {
  //   vpc,
  //   service: ec2.VpcEndpointService.CLOUDWATCH_LOGS,
  //   vpcEndpointType: ec2.VpcEndpointType.INTERFACE,
  //   subnets: {
  //     subnets: vpc.privateSubnets,
  //   },
  //   securityGroups: [this.createVpcEndpointSecurityGroup(vpc, environment)],
  //   policyDocument: new iam.PolicyDocument({
  //     statements: [
  //       new iam.PolicyStatement({
  //         effect: iam.Effect.ALLOW,
  //         principals: [new iam.AnyPrincipal()],
  //         actions: [
  //           "logs:CreateLogGroup",
  //           "logs:CreateLogStream",
  //           "logs:PutLogEvents",
  //           "logs:DescribeLogGroups",
  //           "logs:DescribeLogStreams",
  //         ],
  //         resources: ["*"],
  //         conditions: {
  //           StringEquals: {
  //             "aws:PrincipalTag/Environment": environment,
  //           },
  //         },
  //       }),
  //     ],
  //   }),
  // });

  // CloudWatch Monitoring VPC Endpoint
  // this.vpcEndpoints.monitoring = new ec2.VpcEndpoint(
  //   this,
  //   "MonitoringEndpoint",
  //   {
  //     vpc,
  //     service: ec2.VpcEndpointService.CLOUDWATCH_MONITORING,
  //     vpcEndpointType: ec2.VpcEndpointType.INTERFACE,
  //     subnets: {
  //       subnets: vpc.privateSubnets,
  //     },
  //     securityGroups: [this.createVpcEndpointSecurityGroup(vpc, environment)],
  //     policyDocument: new iam.PolicyDocument({
  //       statements: [
  //         new iam.PolicyStatement({
  //           effect: iam.Effect.ALLOW,
  //           principals: [new iam.AnyPrincipal()],
  //           actions: [
  //             "cloudwatch:PutMetricData",
  //             "cloudwatch:GetMetricStatistics",
  //             "cloudwatch:ListMetrics",
  //           ],
  //           resources: ["*"],
  //           conditions: {
  //             StringEquals: {
  //               "aws:PrincipalTag/Environment": environment,
  //             },
  //           },
  //         }),
  //       ],
  //     }),
  //   }
  // );

  // X-Ray VPC Endpoint
  //   this.vpcEndpoints.xray = new ec2.VpcEndpoint(this, "XRayEndpoint", {
  //     vpc,
  //     service: ec2.VpcEndpointService.XRAY,
  //     vpcEndpointType: ec2.VpcEndpointType.INTERFACE,
  //     subnets: {
  //       subnets: vpc.privateSubnets,
  //     },
  //     securityGroups: [this.createVpcEndpointSecurityGroup(vpc, environment)],
  //     policyDocument: new iam.PolicyDocument({
  //       statements: [
  //         new iam.PolicyStatement({
  //           effect: iam.Effect.ALLOW,
  //           principals: [new iam.AnyPrincipal()],
  //           actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
  //           resources: ["*"],
  //           conditions: {
  //             StringEquals: {
  //               "aws:PrincipalTag/Environment": environment,
  //             },
  //           },
  //         }),
  //       ],
  //     }),
  //   });
  // }

  /**
   * Create security group for VPC endpoints
   */
  private createVpcEndpointSecurityGroup(
    vpc: ec2.Vpc,
    environment: string
  ): ec2.SecurityGroup {
    const securityGroup = new ec2.SecurityGroup(
      this,
      "VpcEndpointSecurityGroup",
      {
        vpc,
        securityGroupName: `manga-vpc-endpoints-${environment}`,
        description: "Security group for VPC endpoints",
        allowAllOutbound: false,
      }
    );

    // Allow HTTPS traffic from Lambda functions
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      "Allow HTTPS from VPC"
    );

    // Allow outbound HTTPS for external API calls
    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow outbound HTTPS"
    );

    return securityGroup;
  }

  /**
   * Create least-privilege IAM roles for all Lambda functions
   */
  private createLambdaRoles(props: SecurityConstructProps): void {
    // Base Lambda execution role with minimal permissions
    const baseLambdaPolicy = new iam.PolicyDocument({
      statements: [
        // Basic Lambda execution permissions
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          resources: [
            `arn:aws:logs:${cdk.Stack.of(this).region}:${
              cdk.Stack.of(this).account
            }:log-group:/aws/lambda/*`,
          ],
        }),
        // X-Ray tracing permissions
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
          resources: ["*"],
        }),
        // CloudWatch metrics permissions
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["cloudwatch:PutMetricData"],
          resources: ["*"],
          conditions: {
            StringEquals: {
              "cloudwatch:namespace": [
                "MangaPlatform/Business",
                "MangaPlatform/Performance",
                "MangaPlatform/ExternalAPI",
              ],
            },
          },
        }),
      ],
    });

    // Post Authentication Trigger Role
    // Assign to a local variable first, then assign to the readonly property only once in the constructor
    const postAuthTriggerRole = new iam.Role(this, "PostAuthTriggerRole", {
      roleName: `manga-post-auth-role-${props.environment}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for Post Authentication Trigger Lambda",
      inlinePolicies: {
        BasePolicy: baseLambdaPolicy,
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["dynamodb:PutItem", "dynamodb:GetItem"],
              resources: [props.mangaTable.tableArn],
              // conditions: {
              //   "ForAllValues:StringEquals": {
              //     "dynamodb:Attributes": [
              //       "PK",
              //       "SK",
              //       "GSI1PK",
              //       "GSI1SK",
              //       "email",
              //       "createdAt",
              //       "status",
              //     ],
              //   },
              // },
            }),
          ],
        }),
      },
      // tags: {
      //   Environment: props.environment,
      //   Service: "MangaPlatform",
      //   Function: "PostAuthTrigger",
      // },
    });
    // Assign to the readonly property only once in the constructor
    (this as { postAuthTriggerRole: iam.Role }).postAuthTriggerRole =
      postAuthTriggerRole;

    // Preferences Processing Role
    const preferencesProcessingRole = new iam.Role(
      this,
      "PreferencesProcessingRole",
      {
        roleName: `manga-preferences-role-${props.environment}`,
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        description: "IAM role for Preferences Processing Lambda",
        inlinePolicies: {
          BasePolicy: baseLambdaPolicy,
          DynamoDBPolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  "dynamodb:PutItem",
                  "dynamodb:GetItem",
                  "dynamodb:UpdateItem",
                  "dynamodb:Query",
                ],
                resources: [
                  props.mangaTable.tableArn,
                  `${props.mangaTable.tableArn}/index/*`,
                ],
                // conditions: {
                //   "ForAllValues:StringEquals": {
                //     "dynamodb:Attributes": [
                //       "PK",
                //       "SK",
                //       "GSI1PK",
                //       "GSI1SK",
                //       "GSI2PK",
                //       "GSI2SK",
                //       "preferences",
                //       "insights",
                //       "createdAt",
                //       "updatedAt",
                //       "status",
                //       "type",
                //     ],
                //   },
                // },
              }),
            ],
          }),
        },
        // Tags will be added after role creation
      }
    );
    (
      this as { preferencesProcessingRole: iam.Role }
    ).preferencesProcessingRole = preferencesProcessingRole;

    // Story Generation Role
    const storyGenerationRole = new iam.Role(this, "StoryGenerationRole", {
      roleName: `manga-story-generation-role-${props.environment}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for Story Generation Lambda",
      inlinePolicies: {
        BasePolicy: baseLambdaPolicy,
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "dynamodb:PutItem",
                "dynamodb:GetItem",
                "dynamodb:UpdateItem",
                "dynamodb:Query",
              ],
              resources: [
                props.mangaTable.tableArn,
                `${props.mangaTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
        S3Policy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:PutObject", "s3:PutObjectAcl"],
              resources: [`${props.contentBucket.bucketArn}/stories/*`],
              conditions: {
                StringEquals: {
                  "s3:x-amz-server-side-encryption": "AES256",
                },
              },
            }),
          ],
        }),
        BedrockPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["bedrock:InvokeModel"],
              resources: [
                `arn:aws:bedrock:${
                  cdk.Stack.of(this).region
                }::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
              ],
            }),
          ],
        }),
        EventBridgePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["events:PutEvents"],
              resources: [props.eventBus.eventBusArn],
              conditions: {
                StringEquals: {
                  "events:source": ["manga.story", "manga.generation"],
                },
              },
            }),
          ],
        }),
      },
      // tags: {
      //   Environment: props.environment,
      //   Service: "MangaPlatform",
      //   Function: "StoryGeneration",
      // },
    });
    (this as { storyGenerationRole: iam.Role }).storyGenerationRole =
      storyGenerationRole;

    // Episode Generation Role
    const episodeGenerationRole = new iam.Role(this, "EpisodeGenerationRole", {
      roleName: `manga-episode-generation-role-${props.environment}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for Episode Generation Lambda",
      inlinePolicies: {
        BasePolicy: baseLambdaPolicy,
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "dynamodb:PutItem",
                "dynamodb:GetItem",
                "dynamodb:UpdateItem",
                "dynamodb:Query",
              ],
              resources: [
                props.mangaTable.tableArn,
                `${props.mangaTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
        S3Policy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject"],
              resources: [`${props.contentBucket.bucketArn}/stories/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:PutObject", "s3:PutObjectAcl"],
              resources: [`${props.contentBucket.bucketArn}/episodes/*`],
              conditions: {
                StringEquals: {
                  "s3:x-amz-server-side-encryption": "AES256",
                },
              },
            }),
          ],
        }),
        BedrockPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["bedrock:InvokeModel"],
              resources: [
                `arn:aws:bedrock:${
                  cdk.Stack.of(this).region
                }::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
              ],
            }),
          ],
        }),
        EventBridgePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["events:PutEvents"],
              resources: [props.eventBus.eventBusArn],
              conditions: {
                StringEquals: {
                  "events:source": ["manga.episode", "manga.generation"],
                },
              },
            }),
          ],
        }),
      },
      // tags: {
      //   Environment: props.environment,
      //   Service: "MangaPlatform",
      //   Function: "EpisodeGeneration",
      // },
    });
    (this as { episodeGenerationRole: iam.Role }).episodeGenerationRole =
      episodeGenerationRole;

    // Image Generation Role
    const imageGenerationRole = new iam.Role(this, "ImageGenerationRole", {
      roleName: `manga-image-generation-role-${props.environment}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for Image Generation Lambda",
      inlinePolicies: {
        BasePolicy: baseLambdaPolicy,
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "dynamodb:GetItem",
                "dynamodb:UpdateItem",
                "dynamodb:Query",
              ],
              resources: [
                props.mangaTable.tableArn,
                `${props.mangaTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
        S3Policy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject"],
              resources: [`${props.contentBucket.bucketArn}/episodes/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:PutObject", "s3:PutObjectAcl"],
              resources: [
                `${props.contentBucket.bucketArn}/images/*`,
                `${props.contentBucket.bucketArn}/episodes/*`,
              ],
              conditions: {
                StringEquals: {
                  "s3:x-amz-server-side-encryption": "AES256",
                },
              },
            }),
          ],
        }),
        BedrockPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["bedrock:InvokeModel"],
              resources: [
                `arn:aws:bedrock:${
                  cdk.Stack.of(this).region
                }::foundation-model/stability.stable-diffusion-xl-v1`,
              ],
            }),
          ],
        }),
        EventBridgePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["events:PutEvents"],
              resources: [props.eventBus.eventBusArn],
              conditions: {
                StringEquals: {
                  "events:source": ["manga.image", "manga.generation"],
                },
              },
            }),
          ],
        }),
      },
      // tags: {
      //   Environment: props.environment,
      //   Service: "MangaPlatform",
      //   Function: "ImageGeneration",
      // },
    });
    (this as { imageGenerationRole: iam.Role }).imageGenerationRole =
      imageGenerationRole;

    // Content Retrieval Role
    const contentRetrievalRole = new iam.Role(this, "ContentRetrievalRole", {
      roleName: `manga-content-retrieval-role-${props.environment}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for Content Retrieval Lambda",
      inlinePolicies: {
        BasePolicy: baseLambdaPolicy,
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["dynamodb:GetItem", "dynamodb:Query"],
              resources: [
                props.mangaTable.tableArn,
                `${props.mangaTable.tableArn}/index/*`,
              ],
              conditions: {
                "ForAllValues:StringEquals": {
                  "dynamodb:Attributes": [
                    "PK",
                    "SK",
                    "GSI1PK",
                    "GSI1SK",
                    "GSI2PK",
                    "GSI2SK",
                    "title",
                    "s3Key",
                    "pdfS3Key",
                    "status",
                    "createdAt",
                    "updatedAt",
                  ],
                },
              },
            }),
          ],
        }),
        S3Policy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject"],
              resources: [
                `${props.contentBucket.bucketArn}/stories/*`,
                `${props.contentBucket.bucketArn}/episodes/*`,
                `${props.contentBucket.bucketArn}/images/*`,
              ],
            }),
          ],
        }),
      },
      // tags: {
      //   Environment: props.environment,
      //   Service: "MangaPlatform",
      //   Function: "ContentRetrieval",
      // },
    });
    (this as { contentRetrievalRole: iam.Role }).contentRetrievalRole =
      contentRetrievalRole;

    // Status Check Role
    const statusCheckRole = new iam.Role(this, "StatusCheckRole", {
      roleName: `manga-status-check-role-${props.environment}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for Status Check Lambda",
      inlinePolicies: {
        BasePolicy: baseLambdaPolicy,
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["dynamodb:GetItem", "dynamodb:Query"],
              resources: [
                props.mangaTable.tableArn,
                `${props.mangaTable.tableArn}/index/*`,
              ],
              conditions: {
                "ForAllValues:StringEquals": {
                  "dynamodb:Attributes": [
                    "PK",
                    "SK",
                    "GSI1PK",
                    "GSI1SK",
                    "GSI2PK",
                    "GSI2SK",
                    "status",
                    "type",
                    "createdAt",
                    "updatedAt",
                    "relatedEntityId",
                  ],
                },
              },
            }),
          ],
        }),
      },
      // tags: {
      //   Environment: props.environment,
      //   Service: "MangaPlatform",
      //   Function: "StatusCheck",
      // },
    });
    (this as { statusCheckRole: iam.Role }).statusCheckRole = statusCheckRole;

    // Workflow Orchestration Role
    const workflowOrchestrationRole = new iam.Role(
      this,
      "WorkflowOrchestrationRole",
      {
        roleName: `manga-workflow-orchestration-role-${props.environment}`,
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        description: "IAM role for Workflow Orchestration Lambda",
        inlinePolicies: {
          BasePolicy: baseLambdaPolicy,
          DynamoDBPolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  "dynamodb:PutItem",
                  "dynamodb:GetItem",
                  "dynamodb:UpdateItem",
                  "dynamodb:Query",
                ],
                resources: [
                  props.mangaTable.tableArn,
                  `${props.mangaTable.tableArn}/index/*`,
                ],
              }),
            ],
          }),
          EventBridgePolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["events:PutEvents"],
                resources: [props.eventBus.eventBusArn],
                conditions: {
                  StringEquals: {
                    "events:source": ["manga.workflow", "manga.generation"],
                  },
                },
              }),
            ],
          }),
        },
      }
    );
    (
      this as { workflowOrchestrationRole: iam.Role }
    ).workflowOrchestrationRole = workflowOrchestrationRole;

    // Continue Episode Role
    const continueEpisodeRole = new iam.Role(this, "ContinueEpisodeRole", {
      roleName: `manga-continue-episode-role-${props.environment}`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for Continue Episode Lambda",
      inlinePolicies: {
        BasePolicy: baseLambdaPolicy,
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "dynamodb:PutItem",
                "dynamodb:GetItem",
                "dynamodb:UpdateItem",
                "dynamodb:Query",
              ],
              resources: [
                props.mangaTable.tableArn,
                `${props.mangaTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
        EventBridgePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["events:PutEvents"],
              resources: [props.eventBus.eventBusArn],
              conditions: {
                StringEquals: {
                  "events:source": ["manga.story", "manga.generation"],
                },
              },
            }),
          ],
        }),
      },
    });
    (this as { continueEpisodeRole: iam.Role }).continueEpisodeRole =
      continueEpisodeRole;
  }

  /**
   * Configure resource-based policies for S3 and DynamoDB
   */
  private configureResourceBasedPolicies(props: SecurityConstructProps): void {
    // S3 Bucket Policy for enhanced security
    const bucketPolicy = new iam.PolicyDocument({
      statements: [
        // Deny unencrypted uploads
        new iam.PolicyStatement({
          sid: "DenyUnencryptedUploads",
          effect: iam.Effect.DENY,
          principals: [new iam.AnyPrincipal()],
          actions: ["s3:PutObject"],
          resources: [`${props.contentBucket.bucketArn}/*`],
          conditions: {
            StringNotEquals: {
              "s3:x-amz-server-side-encryption": "AES256",
            },
          },
        }),
        // Deny insecure transport
        new iam.PolicyStatement({
          sid: "DenyInsecureTransport",
          effect: iam.Effect.DENY,
          principals: [new iam.AnyPrincipal()],
          actions: ["s3:*"],
          resources: [
            props.contentBucket.bucketArn,
            `${props.contentBucket.bucketArn}/*`,
          ],
          conditions: {
            Bool: {
              "aws:SecureTransport": "false",
            },
          },
        }),
        // Note: Lambda access is granted through IAM roles, not resource-based policies
        // to avoid circular dependencies between stacks
      ],
    });

    // Apply the bucket policy
    bucketPolicy.toJSON().Statement.forEach((statement: any) => {
      props.contentBucket.addToResourcePolicy(
        iam.PolicyStatement.fromJson(statement)
      );
    });
  }

  /**
   * Apply security configuration to a Lambda function
   */
  public applyToLambdaFunction(
    lambdaFunction: lambda.Function,
    functionType:
      | "postAuth"
      | "preferences"
      | "storyGeneration"
      | "episodeGeneration"
      | "imageGeneration"
      | "contentRetrieval"
      | "statusCheck"
      | "workflowOrchestration"
      | "continueEpisode"
  ): void {
    // Get the appropriate role based on function type
    let role: iam.Role;
    switch (functionType) {
      case "postAuth":
        role = this.postAuthTriggerRole;
        break;
      case "preferences":
        role = this.preferencesProcessingRole;
        break;
      case "storyGeneration":
        role = this.storyGenerationRole;
        break;
      case "episodeGeneration":
        role = this.episodeGenerationRole;
        break;
      case "imageGeneration":
        role = this.imageGenerationRole;
        break;
      case "contentRetrieval":
        role = this.contentRetrievalRole;
        break;
      case "statusCheck":
        role = this.statusCheckRole;
        break;
      case "workflowOrchestration":
        role = this.workflowOrchestrationRole;
        break;
      case "continueEpisode":
        role = this.continueEpisodeRole;
        break;
      default:
        throw new Error(`Unknown function type: ${functionType}`);
    }

    // Note: CDK doesn't allow changing the role after function creation
    // This method documents the intended role assignment
    // The actual role assignment should be done during function creation

    // Enable X-Ray tracing
    // Note: _X_AMZN_TRACE_ID is automatically managed by the Lambda runtime
    lambdaFunction.addEnvironment(
      "AWS_XRAY_TRACING_NAME",
      `manga-${functionType}`
    );
    lambdaFunction.addEnvironment("AWS_XRAY_CONTEXT_MISSING", "LOG_ERROR");

    // Add security-related environment variables
    lambdaFunction.addEnvironment("ENABLE_SECURITY_LOGGING", "true");
    lambdaFunction.addEnvironment("SECURITY_CONTEXT", functionType);
  }

  /**
   * Get the appropriate IAM role for a Lambda function type
   */
  public getRoleForFunction(
    functionType:
      | "postAuth"
      | "preferences"
      | "storyGeneration"
      | "episodeGeneration"
      | "imageGeneration"
      | "contentRetrieval"
      | "statusCheck"
      | "workflowOrchestration"
      | "continueEpisode"
  ): iam.Role {
    switch (functionType) {
      case "postAuth":
        return this.postAuthTriggerRole;
      case "preferences":
        return this.preferencesProcessingRole;
      case "storyGeneration":
        return this.storyGenerationRole;
      case "episodeGeneration":
        return this.episodeGenerationRole;
      case "imageGeneration":
        return this.imageGenerationRole;
      case "contentRetrieval":
        return this.contentRetrievalRole;
      case "statusCheck":
        return this.statusCheckRole;
      case "workflowOrchestration":
        return this.workflowOrchestrationRole;
      case "continueEpisode":
        return this.continueEpisodeRole;
      default:
        throw new Error(`Unknown function type: ${functionType}`);
    }
  }
}
