import { DynamoDBStreamHandler } from "aws-lambda";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";

const client = new SESClient({ region: process.env.SES_REGION });
const senderEmail = process.env.SES_EMAIL_FROM;
const recipientEmail = process.env.SES_EMAIL_TO;

export const handler: DynamoDBStreamHandler = async (event) => {
  if (!senderEmail || !recipientEmail) {
    console.error("Sender or recipient email is not defined.");
    throw new Error(
      "SES_EMAIL_FROM or SES_EMAIL_TO environment variables are missing."
    );
  }

  for (const record of event.Records) {
    if (record.eventName === "INSERT") {
      const newImage = record.dynamodb?.NewImage;
      if (newImage) {
        const fileName = newImage.fileName.S;

        const params: SendEmailCommandInput = {
          Destination: {
            ToAddresses: [recipientEmail],
          },
          Message: {
            Body: {
              Html: {
                Charset: "UTF-8",
                Data: `<p>A new image with fileName <strong>${fileName}</strong> has been added to the album.</p>`,
              },
            },
            Subject: {
              Charset: "UTF-8",
              Data: "New Image Added Notification",
            },
          },
          Source: senderEmail,
        };

        try {
          await client.send(new SendEmailCommand(params));
          console.log(`Email notification sent for new image: ${fileName}`);
        } catch (error) {
          console.error("Error sending email notification:", error);
        }
      }
    }
  }
};
