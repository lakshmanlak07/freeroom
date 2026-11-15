/**
 * Event-driven notifications (BR-7, F4). DynamoDB Streams → onChange: every domain change appends
 * an immutable EVT item, so INSERTs of EVT images ARE the domain events. Recipients come from the
 * internal `notify` attribute. Idempotent per event id (deterministic notification key).
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AlternativeRoom } from '@freeroom/shared';
import type { ContactService } from '../contact';
import type { Db, Item } from '../data/db';
import { putNotification, type NotificationDraft } from '../data/notifications';
import { getPrivate } from '../data/users';
import type { Logger } from '../logger';
import { metric } from '../metrics';

export interface ChangeRecord {
  eventName?: 'INSERT' | 'MODIFY' | 'REMOVE';
  newImage?: Item;
  oldImage?: Item;
}

interface Template {
  type: string;
  title: string;
  body: string;
  alternatives?: AlternativeRoom[];
}

function template(e: Item): Template | null {
  const data = (e.data ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'CLAIM_REQUESTED':
      return {
        type: 'claim.received',
        title: 'Someone requested your room',
        body: 'Approve or deny the request before the 4-hour cutoff.',
      };
    case 'CLAIM_APPROVED':
      return {
        type: 'claim.approved',
        title: 'Your room request was approved',
        body:
          data.mode === 'TRANSFER'
            ? 'The reservation is now yours.'
            : 'The owner shared their contact details — open the request to see them.',
      };
    case 'CLAIM_DENIED':
      return {
        type: 'claim.denied',
        title: 'Your room request was declined',
        body: 'Try another free room nearby.',
      };
    case 'CLAIM_EXPIRED':
      return {
        type: 'claim.expired',
        title: 'Your room request expired',
        body: 'The owner did not respond before the cutoff. The reservation stays with them.',
      };
    case 'ATTENDEE_JOINED':
      return {
        type: 'invite.joined',
        title: `${(data.alias as string | undefined) ?? 'Someone'} joined your study session`,
        body: 'They used your invite link. You can see everyone on My Reservations.',
      };
    case 'ATTENDEE_LEFT':
      return {
        type: 'invite.left',
        title: `${(data.alias as string | undefined) ?? 'Someone'} left your study session`,
        body: 'One more seat is open.',
      };
    case 'CANCELLED':
      return {
        type: 'reservation.cancelled',
        title: 'Study session cancelled',
        body: 'The host cancelled this booking. Find another free room nearby.',
      };
    case 'TRANSFERRED':
      return {
        type: 'reservation.transferred',
        title: 'Reservation transferred',
        body: 'Ownership changed after an approved request.',
      };
    case 'RELEASED':
      if (e.reason === 'UNCONFIRMED') {
        return {
          type: 'reservation.auto_released',
          title: 'Reservation auto-released',
          body: 'It was not confirmed before the 4-hour cutoff, so the room was freed.',
        };
      }
      if (e.reason === 'CLASS_CONFLICT') {
        const cls = (data.class ?? {}) as { name?: string };
        const alternatives = (data.alternatives ?? []) as AlternativeRoom[];
        return {
          type: 'reservation.class_conflict',
          title: 'A class now needs your room',
          body: `${cls.name ?? 'A class'} was scheduled in your room. Classes take priority — here are ${alternatives.length} free alternatives.`,
          alternatives,
        };
      }
      return null;
    default:
      return null;
  }
}

/** Pure: one stream record → zero or more notifications. */
export function mapRecord(r: ChangeRecord): NotificationDraft[] {
  const e = r.newImage;
  if (r.eventName !== 'INSERT' || !e || !String(e.SK ?? '').startsWith('EVT#')) return [];
  const t = template(e);
  if (!t) return [];
  const recipients = [...new Set([...((e.notify as Iterable<string> | undefined) ?? [])])];
  return recipients.map((userId) => ({
    userId,
    notifId: `${e.at as string}#${e.eventId as string}`,
    type: t.type,
    reservationId: (e.reservationId as string | undefined) ?? null,
    title: t.title,
    body: t.body,
    createdAt: e.at as string,
    ...(t.alternatives ? { alternatives: t.alternatives } : {}),
  }));
}

/**
 * Lambda stream record (marshalled) → ChangeRecord. Only audit-event items (SK `EVT#…`) are
 * decoded: they are the only images the notifier reads, and other items (e.g. a quota map that
 * just became empty, which the streams client returns as `{}`) cannot always be unmarshalled.
 */
export function fromStreamRecord(r: {
  eventName?: string;
  dynamodb?: { NewImage?: Record<string, unknown>; OldImage?: Record<string, unknown> };
}): ChangeRecord {
  const isEvent = (img?: Record<string, unknown>) =>
    String((img?.SK as { S?: string } | undefined)?.S ?? '').startsWith('EVT#');
  const um = (img?: Record<string, unknown>) =>
    img && isEvent(img) ? (unmarshall(img as never) as Item) : undefined;
  return {
    eventName: r.eventName as ChangeRecord['eventName'],
    newImage: um(r.dynamodb?.NewImage),
    oldImage: um(r.dynamodb?.OldImage),
  };
}

export type SendEmail = (to: string, subject: string, body: string) => Promise<void>;

export function sesSender(from: string, ses = new SESv2Client({})): SendEmail {
  return async (to, subject, body) => {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } },
      }),
    );
  };
}

export interface OnChangeDeps {
  db: Db;
  log: Logger;
  /** Email only when SES_FROM is configured (both present). */
  sendEmail?: SendEmail;
  contacts?: ContactService;
}

export async function onChange(deps: OnChangeDeps, records: ChangeRecord[]): Promise<number> {
  let created = 0;
  for (const r of records) {
    if (r.newImage?.correlationId)
      deps.log.info('notify.event', {
        correlationId: r.newImage.correlationId,
        eventType: r.newImage.type,
        reservationId: r.newImage.reservationId,
      });
  }
  for (const draft of records.flatMap(mapRecord)) {
    if (!(await putNotification(deps.db, draft))) continue; // duplicate delivery
    created++;
    if (deps.sendEmail && deps.contacts) {
      try {
        const enc = await getPrivate(deps.db, draft.userId);
        const email = enc && (await deps.contacts.decrypt(draft.userId, enc)).email;
        if (email) await deps.sendEmail(email, `FreeRoom: ${draft.title}`, draft.body);
      } catch (e) {
        // Error name only: provider messages can echo the recipient address.
        metric('NotificationFailures');
        deps.log.warn('notify.email_failed', { type: draft.type, errorName: (e as Error).name }); // in-app copy already stored
      }
    }
  }
  return created;
}
