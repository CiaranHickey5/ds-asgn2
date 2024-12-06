import { SQSHandler } from "aws-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const dynamoDb = new DynamoDBClient({});
const tableName = process.env.IMAGE_TABLE_NAME;

export const handler: SQSHandler = async (event) => {
  if (!tableName) {
    console.error("Table name is not defined in environment variables.");
    throw new Error("IMAGE_TABLE_NAME environment variable is missing.");
  }

  for (const record of event.Records) {
    const snsMessage = JSON.parse(record.body).Message;
    const s3Event = JSON.parse(snsMessage).Records[0].s3;

    const srcKey = decodeURIComponent(s3Event.object.key.replace(/\+/g, " "));
    const fileExtension = srcKey.split(".").pop()?.toLowerCase();

    if (!["jpeg", "png"].includes(fileExtension || "")) {
      console.error(`Invalid file type: ${fileExtension}`);
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }

    // Add record to DynamoDB for valid files
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
};
