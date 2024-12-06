import { DynamoDBStreamHandler } from "aws-lambda";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";
import { SES_EMAIL_FROM, SES_REGION, SES_EMAIL_TO } from "../env";

const ses = new SESClient({ region: SES_REGION });
const senderEmail = SES_EMAIL_FROM;

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName === "INSERT") {
      const newImage = record.dynamodb?.NewImage;
      if (newImage) {
        const fileName = newImage.fileName.S;

        const params: SendEmailCommandInput = {
          Destination: {
            ToAddresses: [SES_EMAIL_TO],
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
          await ses.send(new SendEmailCommand(params));
          console.log(`Email notification sent for new image: ${fileName}`);
        } catch (error) {
          console.error("Error sending email notification:", error);
        }
      }
    }
  }
};
