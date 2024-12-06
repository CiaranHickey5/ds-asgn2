import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import { StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";

import { Construct } from "constructs";

export class Asgn2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // Integration infrastructure

    const imageDLQ = new sqs.Queue(this, "img-created-dlq", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      retentionPeriod: cdk.Duration.days(14),
    });

    const imageLogQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: imageDLQ,
        maxReceiveCount: 1,
      },
    });

    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    const confirmationMailerQ = new sqs.Queue(
      this,
      "confirmationMailer-queue",
      {
        receiveMessageWaitTime: cdk.Duration.seconds(10),
      }
    );

    const newImageMailEventSource = new events.SqsEventSource(
      confirmationMailerQ,
      {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      }
    );

    const imageTable = new cdk.aws_dynamodb.Table(this, "ImageTable", {
      partitionKey: {
        name: "fileName",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      stream: StreamViewType.NEW_IMAGE,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
      billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Lambda functions

    const logImageFn = new lambdanode.NodejsFunction(this, "LogImageFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/logImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        IMAGE_TABLE_NAME: imageTable.tableName,
      },
    });

    const confirmationMailerFn = new lambdanode.NodejsFunction(
      this,
      "confirmationMailer-function",
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize: 1024,
        timeout: cdk.Duration.seconds(3),
        entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
      }
    );

    const rejectionFn = new lambdanode.NodejsFunction(this, "RejectionLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(15),
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
    });

    const updateTableFn = new lambdanode.NodejsFunction(this, "UpdateTableFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/updateTable.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        IMAGE_TABLE_NAME: imageTable.tableName,
      },
    });

    const processImageFn = new lambdanode.NodejsFunction(this, "ProcessImageFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        IMAGE_TABLE_NAME: imageTable.tableName,
      },
    });

    // S3 --> SNS (Object Created and Deleted Events)
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.SnsDestination(newImageTopic)
    );

    // SNS --> SQS --> Lambda (Log Image)
    // Subscribe LogImageFn Lambda to the SNS topic without filter policy
    newImageTopic.addSubscription(new subs.SqsSubscription(imageLogQueue));

    // SNS --> SQS --> Lambda (Confirmation Mailer)
    // Subscribe Confirmation Mailer Queue to the SNS topic without filter policy
    newImageTopic.addSubscription(
      new subs.SqsSubscription(confirmationMailerQ)
    );

    // SNS --> Lambda (Update Table for Metadata Updates)
    // Subscribe UpdateTableFn Lambda to the SNS topic with a filter policy to allow only metadata updates
    newImageTopic.addSubscription(
      new subs.LambdaSubscription(updateTableFn, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption", "Date", "Photographer"],
          }),
        },
      })
    );

    // S3 Deletion --> SNS --> Lambda (Process Image)
    newImageTopic.addSubscription(
      new subs.LambdaSubscription(processImageFn, {
        filterPolicy: {
          event_name: sns.SubscriptionFilter.stringFilter({
            allowlist: ["ObjectRemoved:Delete"]
          }),
        },
      })
    );

    // DynamoDB Stream --> Lambda (Confirmation Mailer for new images added)
    confirmationMailerFn.addEventSource(
      new DynamoEventSource(imageTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 5,
        retryAttempts: 2,
      })
    );

    // Lambda Event Sources
    logImageFn.addEventSource(new events.SqsEventSource(imageLogQueue));
    confirmationMailerFn.addEventSource(
      new events.SqsEventSource(confirmationMailerQ)
    );
    rejectionFn.addEventSource(new events.SqsEventSource(imageDLQ));

    // Permissions
    imagesBucket.grantReadWrite(logImageFn);
    imagesBucket.grantReadWrite(processImageFn);
    imageTable.grantWriteData(logImageFn);
    imageTable.grantWriteData(updateTableFn);
    imageTable.grantWriteData(processImageFn);

    confirmationMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    rejectionFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    // Output
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });
  }
}
