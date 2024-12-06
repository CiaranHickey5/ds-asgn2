import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  GetObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";

const s3 = new S3Client();

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body); // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        const fileExtension = srcKey.split('.').pop()?.toLowerCase();

        // Validate file type
        if (!["jpeg", "png"].includes(fileExtension || "")) {
          console.error(`Invalid file type: ${fileExtension}`);
          throw new Error(`Unsupported file type: ${fileExtension}`);
        }

        console.log(`Processing valid file: ${srcKey}`);

        try {
          // Download the image from the S3 source bucket
          const params: GetObjectCommandInput = {
            Bucket: srcBucket,
            Key: srcKey,
          };
          const origimage = await s3.send(new GetObjectCommand(params));

          console.log("File processed successfully:", origimage);
        } catch (error) {
          console.error("Error processing file:", error);
          throw error;
        }
      }
    }
  }
};
