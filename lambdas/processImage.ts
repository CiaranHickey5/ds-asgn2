import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { SNSEvent, Context, Callback } from "aws-lambda";

const dynamoDb = new DynamoDBClient({});
const tableName = process.env.IMAGE_TABLE_NAME;

export const handler = async (
  event: SNSEvent,
  context: Context,
  callback: Callback
) => {
  if (!tableName) {
    console.error("Table name is not defined in environment variables.");
    throw new Error("IMAGE_TABLE_NAME environment variable is missing.");
  }

  for (const record of event.Records) {
    const snsMessage = JSON.parse(record.Sns.Message);
    const { key: fileName } = snsMessage.s3.object;

    if (!fileName) {
      console.error("Invalid S3 deletion event message.");
      continue;
    }

    try {
      const params = {
        TableName: tableName,
        Key: {
          fileName: { S: fileName },
        },
      };
      await dynamoDb.send(new DeleteItemCommand(params));
      console.log(`Successfully deleted item with fileName: ${fileName}`);
    } catch (error) {
      console.error("Error deleting item from DynamoDB:", error);
    }
  }

  callback(null, "Deletion processing completed");
};
