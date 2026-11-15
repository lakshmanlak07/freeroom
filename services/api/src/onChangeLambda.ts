/**
 * DynamoDB Streams consumer (DLQ configured in CDK). Throwing makes Lambda retry the batch;
 * onChange is idempotent per event id, so retries never duplicate notifications.
 */
import { AwsKmsKeyProvider, ContactService } from './contact';
import { makeDb } from './data/db';
import { createLogger } from './logger';
import { metric } from './metrics';
import { fromStreamRecord, onChange, sesSender } from './notify/onChange';

const db = makeDb({ table: process.env.TABLE_NAME! });
const log = createLogger({ service: 'onChange' });
const from = process.env.SES_FROM;
const keyId = process.env.CONTACT_KMS_KEY_ID;

export const handler = async (event: { Records: Parameters<typeof fromStreamRecord>[0][] }) => {
  let created: number;
  try {
    created = await onChange(
      {
        db,
        log,
        // Email needs the recipient's address, so this function's role gets kms:Decrypt only if SES_FROM is set.
        ...(from && keyId
          ? {
              sendEmail: sesSender(from),
              contacts: new ContactService(new AwsKmsKeyProvider(keyId)),
            }
          : {}),
      },
      event.Records.map(fromStreamRecord),
    );
  } catch (e) {
    metric('NotificationFailures', event.Records.length); // batch retries, then the DLQ
    throw e;
  }
  log.info('notify.batch', { records: event.Records.length, created });
};
