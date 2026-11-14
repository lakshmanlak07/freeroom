import { overlaps, type Interval } from './time';

/** A 25Live class/event cached for a room (BR-3 tooltip fields included). */
export interface ClassEvent extends Interval {
  eventId: string;
  roomId: string;
  name: string;
  courseCode?: string;
  section?: string;
  eventType?: string;
  organization?: string;
}

/** BR-1: every class in the same room that overlaps the requested interval. */
export const findClassConflicts = (
  req: Interval & { roomId: string },
  classes: readonly ClassEvent[],
): ClassEvent[] => classes.filter((c) => c.roomId === req.roomId && overlaps(req, c));
