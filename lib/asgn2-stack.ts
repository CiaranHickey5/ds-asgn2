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

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

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

    // S3 --> SNS
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    // SNS --> SQS --> Lambda
    newImageTopic.addSubscription(new subs.SqsSubscription(imageLogQueue));
    newImageTopic.addSubscription(
      new subs.SqsSubscription(confirmationMailerQ)
    );

    logImageFn.addEventSource(new events.SqsEventSource(imageLogQueue));
    confirmationMailerFn.addEventSource(newImageMailEventSource);

    rejectionFn.addEventSource(new events.SqsEventSource(imageDLQ));

    // Add filter policies for metadata to SNS subscriptions
    newImageTopic.addSubscription(
      new subs.LambdaSubscription(updateTableFn, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption", "Date", "Photographer"],
          }),
        },
      })
    );

    // Permissions

    imagesBucket.grantReadWrite(logImageFn);
    imageTable.grantWriteData(logImageFn);
    imageTable.grantWriteData(updateTableFn);

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
