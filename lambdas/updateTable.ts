import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
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
    const message = JSON.parse(record.Sns.Message);

    const { id, value } = message;
    const metadataType = record.Sns.MessageAttributes.metadata_type?.Value;

    if (!id || !value || !metadataType) {
      console.error("Invalid message format: ", JSON.stringify(message));
      continue;
    }

    try {
      const params = {
        TableName: tableName,
        Key: {
          fileName: { S: id },
        },
        UpdateExpression: "SET #attrName = :attrValue",
        ExpressionAttributeNames: {
          "#attrName": metadataType,
        },
        ExpressionAttributeValues: {
          ":attrValue": { S: value },
        },
      };

      await dynamoDb.send(new UpdateItemCommand(params));
      console.log(
        `Successfully updated item with id: ${id} and ${metadataType}: ${value}`
      );
    } catch (error) {
      console.error("Error updating DynamoDB:", error);
    }
  }

  callback(null, "Update completed");
};
