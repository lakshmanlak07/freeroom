/**
 * Cognito pre-token-generation trigger: adds `role` and `registered` claims. Never PII
 * (no email/phone/universityId). The API still reads role from the DB on every request.
 */
import { makeDb, type Db } from './data/db';
import { getUser } from './data/users';

export interface PreTokenEvent {
  request: { userAttributes: Record<string, string> };
  response: {
    claimsOverrideDetails?: { claimsToAddOrOverride?: Record<string, string> };
  };
}

export async function addClaims(db: Db, event: PreTokenEvent): Promise<PreTokenEvent> {
  const sub = event.request.userAttributes.sub;
  const user = sub ? await getUser(db, sub) : null;
  event.response = {
    ...event.response,
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        registered: user ? 'true' : 'false',
        ...(user && { role: user.role }),
      },
    },
  };
  return event;
}

let db: Db | undefined;
export const handler = (event: PreTokenEvent) =>
  addClaims((db ??= makeDb({ table: process.env.TABLE_NAME! })), event);
