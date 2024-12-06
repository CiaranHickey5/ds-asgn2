import { SQSHandler } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
  GetObjectCommand,
  GetObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";

const dynamoDb = new DynamoDBClient({});
const s3 = new S3Client();
const tableName = process.env.IMAGE_TABLE_NAME;

export const handler: SQSHandler = async (event) => {
  console.log("Event: ", JSON.stringify(event));

  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body); // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      console.log("SNS Records: ", JSON.stringify(snsMessage));
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        const fileExtension = srcKey.split(".").pop()?.toLowerCase();

        // Validate file type
        if (!["jpeg", "png"].includes(fileExtension || "")) {
          console.error(`Invalid file type: ${fileExtension}`);
          throw new Error(`Unsupported file type: ${fileExtension}`);
        }

        console.log(`Processing valid file: ${srcKey}`);

        // Add record to DynamoDB
        try {
          const params = {
            TableName: tableName,
            Item: {
              fileName: { S: srcKey },
            },
          };
          await dynamoDb.send(new PutItemCommand(params));
          console.log(`File ${srcKey} added to DynamoDB table.`);
        } catch (error) {
          console.error("Error writing to DynamoDB:", error);
          throw error;
        }
      }
    }
  }
};
