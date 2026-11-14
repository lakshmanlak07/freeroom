/** Realistic UMass-like demo data for MSW (mirrors the API's seeded MockSource closely). */
import { addDays, campusDay, campusLocalToUtc, cutoffAt, overlaps } from '@freeroom/domain';
import type {
  ClassItem,
  Equipment,
  MeResponse,
  Notification,
  ReservationDetail,
  ReservationStatus,
  Room,
} from '@freeroom/shared';

export const BUILDINGS = [
  { buildingId: 'LGRT', name: 'Lederle Graduate Research Tower', lat: 42.394, lng: -72.5265 },
  { buildingId: 'ILC', name: 'Integrative Learning Center', lat: 42.3911, lng: -72.5262 },
  { buildingId: 'CS', name: 'Computer Science Building', lat: 42.3951, lng: -72.531 },
  { buildingId: 'DUBOIS', name: 'W.E.B. Du Bois Library', lat: 42.3896, lng: -72.5283 },
  { buildingId: 'GOESS', name: 'Goessmann Laboratory', lat: 42.394, lng: -72.5282 },
  { buildingId: 'HAS', name: 'Hasbrouck Laboratory', lat: 42.3922, lng: -72.5262 },
  { buildingId: 'ISEN', name: 'Isenberg School of Management', lat: 42.387, lng: -72.5245 },
  { buildingId: 'TOBIN', name: 'Tobin Hall', lat: 42.3888, lng: -72.5291 },
  { buildingId: 'MORRILL', name: 'Morrill Science Center', lat: 42.3909, lng: -72.5243 },
  { buildingId: 'MARCUS', name: 'Marcus Hall', lat: 42.3934, lng: -72.5295 },
];

const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const pick = <T>(seed: string, xs: readonly T[]) => xs[hash(seed) % xs.length]!;

const NUMS = ['0101', '0111', '0121', '0201', '0211', '0221', '0301', '0311'];
const CAPS = [8, 12, 16, 24, 30, 40, 60, 80, 120, 150, 200, 300];
const EQUIP: Equipment[] = ['projector', 'whiteboard', 'computers', 'outlets', 'accessible'];

export const ROOMS: Room[] = BUILDINGS.flatMap((b) =>
  NUMS.map((n) => ({
    roomId: `${b.buildingId}-${n}`,
    buildingId: b.buildingId,
    buildingName: b.name,
    name: `${b.buildingId} ${n}`,
    capacity: pick(`cap${b.buildingId}${n}`, CAPS),
    equipment: EQUIP.filter((e) => hash(`${e}${b.buildingId}${n}`) % 100 < 55),
    lat: b.lat,
    lng: b.lng,
  })),
);

const COURSES = [
  ['COMPSCI 220', 'Programming Methodology', 'Computer Science'],
  ['COMPSCI 311', 'Introduction to Algorithms', 'Computer Science'],
  ['MATH 131', 'Calculus I', 'Mathematics & Statistics'],
  ['MATH 235', 'Linear Algebra', 'Mathematics & Statistics'],
  ['PHYSICS 151', 'General Physics I', 'Physics'],
  ['CHEM 111', 'General Chemistry', 'Chemistry'],
  ['BIOLOGY 151', 'Introductory Biology I', 'Biology'],
  ['ECON 103', 'Introduction to Microeconomics', 'Economics'],
  ['PSYCH 100', 'Introduction to Psychology', 'Psychological & Brain Sciences'],
  ['STATISTC 240', 'Introduction to Statistics', 'Mathematics & Statistics'],
] as const;
const MWF = ['08:00', '09:05', '10:10', '11:15', '12:20', '13:25', '14:30', '15:35'];
const TUTH = ['08:30', '10:00', '11:30', '13:00', '14:30', '16:00'];

/** Deterministic weekday classes for a room on a campus day (MWF 50 min, TuTh 75 min). */
export function classesFor(room: Room, day: string): ClassItem[] {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const [times, minutes] = [1, 3, 5].includes(dow)
    ? [MWF, 50]
    : [2, 4].includes(dow)
      ? [TUTH, 75]
      : [[], 0];
  return times.flatMap((t) => {
    if (hash(`${room.roomId}${t}${dow % 2}`) % 100 >= 42) return [];
    const [code, name, org] = pick(`${room.roomId}${t}`, COURSES);
    const start = campusLocalToUtc(`${day}T${t}`);
    const section = String(1 + (hash(`${room.roomId}${t}s`) % 4)).padStart(2, '0');
    return [
      {
        kind: 'class' as const,
        eventId: `EV-${room.roomId}-${day}-${t}`,
        name,
        courseCode: code,
        section,
        eventType: room.capacity >= 100 ? 'Lecture' : room.capacity <= 24 ? 'Discussion' : 'Class',
        organization: org,
        start: start.toISOString(),
        end: new Date(start.getTime() + minutes * 60_000).toISOString(),
        roomId: room.roomId,
        roomName: room.name,
        buildingName: room.buildingName,
      },
    ];
  });
}

export interface MockReservation {
  id: string;
  roomId: string;
  ownerId: string;
  start: string;
  end: string;
  partySize: number;
  purpose?: string;
  status: ReservationStatus;
  createdAt: string;
  cutoffAt: string;
  confirmedAt: string | null;
}

export const USERS: Record<string, MeResponse> = {
  student1: {
    userId: 'student1',
    role: 'STUDENT',
    displayAlias: 'Night Owl',
    shareChannel: 'email',
    contact: { email: 'student1@demo.freeroom.test' },
  },
  student2: {
    userId: 'student2',
    role: 'STUDENT',
    displayAlias: 'Early Bird',
    shareChannel: 'email',
    contact: { email: 'student2@demo.freeroom.test' },
  },
  faculty1: {
    userId: 'faculty1',
    role: 'FACULTY',
    displayAlias: 'Prof. Maple',
    shareChannel: 'email',
    contact: { email: 'faculty1@demo.freeroom.test' },
  },
  tutor1: {
    userId: 'tutor1',
    role: 'TUTOR',
    displayAlias: 'Tutor Pine',
    shareChannel: 'phone',
    contact: { phone: '+1 413 555 0100' },
  },
  admin1: {
    userId: 'admin1',
    role: 'ADMIN',
    displayAlias: 'FreeRoom Admin',
    shareChannel: 'email',
    contact: { email: 'admin1@demo.freeroom.test' },
  },
};

function seedReservations(now: Date): MockReservation[] {
  const today = campusDay(now);
  const tomorrow = addDays(today, 1);
  const mk = (
    id: string,
    roomId: string,
    ownerId: string,
    day: string,
    from: string,
    to: string,
    status: ReservationStatus,
  ): MockReservation => {
    const start = campusLocalToUtc(`${day}T${from}`);
    return {
      id,
      roomId,
      ownerId,
      start: start.toISOString(),
      end: campusLocalToUtc(`${day}T${to}`).toISOString(),
      partySize: 4,
      status,
      createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
      cutoffAt: cutoffAt(start).toISOString(),
      confirmedAt: status === 'CONFIRMED' ? now.toISOString() : null,
    };
  };
  const seeds = [
    mk('res-lgrt-eve', 'LGRT-0101', 'student2', today, '19:00', '20:30', 'CONFIRMED'),
    mk('res-lgrt-late', 'LGRT-0101', 'faculty1', today, '21:00', '22:00', 'CONFIRMED'),
    mk('res-cs-mine', 'CS-0111', 'student1', tomorrow, '18:00', '19:30', 'PENDING_CONFIRMATION'),
    mk('res-ilc-tmrw', 'ILC-0101', 'tutor1', tomorrow, '17:30', '19:00', 'CONFIRMED'),
    mk('res-dubois', 'DUBOIS-0201', 'faculty1', today, '18:00', '20:00', 'CONFIRMED'),
  ];
  // Keep only seeds that don't sit on a class (BR-1 holds in mocks too).
  return seeds.filter((r) => {
    const room = ROOMS.find((x) => x.roomId === r.roomId)!;
    const cls = classesFor(room, campusDay(new Date(r.start)));
    return !cls.some((c) =>
      overlaps(
        { start: new Date(c.start), end: new Date(c.end) },
        { start: new Date(r.start), end: new Date(r.end) },
      ),
    );
  });
}

export function seedNotifications(now: Date): Notification[] {
  const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();
  return [
    {
      id: 'n1',
      type: 'claim.approved',
      reservationId: 'res-lgrt-eve',
      title: 'Your room request was approved',
      body: 'The owner shared their contact details.',
      read: false,
      createdAt: at(12),
    },
    {
      id: 'n2',
      type: 'reservation.auto_released',
      reservationId: null,
      title: 'Reservation auto-released',
      body: 'It was not confirmed before the 4-hour cutoff.',
      read: false,
      createdAt: at(95),
    },
    {
      id: 'n3',
      type: 'claim.denied',
      reservationId: null,
      title: 'Your room request was declined',
      body: 'Try another free room nearby.',
      read: true,
      createdAt: at(60 * 26),
    },
  ];
}

const boot = new Date();
export const db = {
  reservations: seedReservations(boot),
  registered: new Map<string, MeResponse>(Object.entries(USERS)),
  idempotency: new Map<string, { hash: string; body: ReservationDetail }>(),
  notifications: new Map<string, Notification[]>([['student1', seedNotifications(boot)]]),
  claims: [] as { claimId: string; reservationId: string; requesterId: string }[],
  lastSyncedAt: new Date(boot.getTime() - 4 * 60_000).toISOString(),
};
