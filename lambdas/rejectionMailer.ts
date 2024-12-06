import { SQSHandler } from "aws-lambda";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";
import { SES_EMAIL_FROM, SES_REGION, SES_EMAIL_TO } from "../env";

const ses = new SESClient({ region: SES_REGION });
const senderEmail = SES_EMAIL_FROM;

export const handler: SQSHandler = async (event) => {
  if (!senderEmail) {
    console.error("Sender email is not defined in environment variables.");
    throw new Error("SES_EMAIL_FROM environment variable is missing.");
  }

  for (const record of event.Records) {
    const message =
      "Your recent file upload was rejected due to unsupported file type.";

    const params: SendEmailCommandInput = {
      Destination: {
        ToAddresses: [SES_EMAIL_TO],
      },
      Message: {
        Body: {
          Text: {
            Charset: "UTF-8",
            Data: message,
          },
        },
        Subject: {
          Charset: "UTF-8",
          Data: "File Upload Rejection Notification",
        },
      },
      Source: senderEmail,
    };

    try {
      await ses.send(new SendEmailCommand(params));
      console.log("Rejection email sent successfully.");
    } catch (error) {
      console.error("Error sending rejection email:", error);
    }
  }
};
