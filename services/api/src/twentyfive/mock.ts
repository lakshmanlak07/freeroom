/**
 * Deterministic UMass-like campus in raw 25Live shape. The same raw records feed MockSource
 * (through mapper.ts, so the mapper is exercised) and the /mock25live/* endpoints.
 */
import {
  addDays,
  campusLocalToUtc,
  formatCampus,
  overlaps,
  type ClassEvent,
} from '@freeroom/domain';
import { CAMPUS_BUILDINGS } from './campus';
import { mapReservation, mapSpace, type RawReservation, type RawSpace } from './mapper';
import type { ScheduleSource, SourceRoom } from './source';

export type { RawReservation, RawSpace };

/** Small deterministic PRNG (mulberry32) seeded from a string. */
function rng(seed: string): () => number {
  let a = 0;
  for (const ch of seed) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const hashNum = (s: string) => Math.floor(rng(s)() * 2_000_000_000) + 1;

const ROOMS_PER_BUILDING = 8;
const CAPACITIES = [8, 12, 16, 20, 24, 30, 36, 40, 48, 60, 80, 100, 150, 200, 300];
const FEATURES = ['Projector', 'Whiteboard', 'Computers', 'Power Outlets', 'ADA Accessible'];

const COURSES: readonly [string, string, readonly [string, string][]][] = [
  [
    'COMPSCI',
    'Computer Science',
    [
      ['220', 'Programming Methodology'],
      ['240', 'Reasoning Under Uncertainty'],
      ['311', 'Introduction to Algorithms'],
      ['326', 'Web Programming'],
    ],
  ],
  [
    'MATH',
    'Mathematics',
    [
      ['131', 'Calculus I'],
      ['132', 'Calculus II'],
      ['235', 'Linear Algebra'],
      ['455', 'Discrete Mathematics'],
    ],
  ],
  [
    'PHYSICS',
    'Physics',
    [
      ['151', 'General Physics I'],
      ['152', 'General Physics II'],
    ],
  ],
  [
    'CHEM',
    'Chemistry',
    [
      ['111', 'General Chemistry'],
      ['261', 'Organic Chemistry'],
    ],
  ],
  [
    'BIOLOGY',
    'Biology',
    [
      ['151', 'Introductory Biology I'],
      ['283', 'Genetics'],
    ],
  ],
  [
    'ECON',
    'Economics',
    [
      ['103', 'Introduction to Microeconomics'],
      ['104', 'Introduction to Macroeconomics'],
    ],
  ],
  [
    'PSYCH',
    'Psychological & Brain Sciences',
    [
      ['100', 'Introduction to Psychology'],
      ['241', 'Social Psychology'],
    ],
  ],
  ['STATISTC', 'Mathematics & Statistics', [['240', 'Introduction to Statistics']]],
  [
    'ENGLISH',
    'English',
    [
      ['112', 'College Writing'],
      ['220', 'Shakespeare'],
    ],
  ],
  ['HISTORY', 'History', [['150', 'US History Since 1876']]],
];

// MWF 50-min and TuTh 75-min blocks (campus local time).
const MWF = ['08:00', '09:05', '10:10', '11:15', '12:20', '13:25', '14:30', '15:35'];
const TUTH = ['08:30', '10:00', '11:30', '13:00', '14:30', '16:00'];

export function mockSpaces(): RawSpace[] {
  return CAMPUS_BUILDINGS.flatMap((b) => {
    const r = rng(b.buildingId);
    return Array.from({ length: ROOMS_PER_BUILDING }, (_, i) => {
      const num = String((Math.floor(i / 3) + 1) * 100 + (i % 3) * 10 + 1).padStart(4, '0');
      return {
        space_id: hashNum(`${b.buildingId}-${num}`),
        space_name: `${b.buildingId} ${num}`,
        max_capacity: pick(r, CAPACITIES),
        building_code: b.buildingId,
        features: FEATURES.filter(() => r() < 0.55).map((feature_name) => ({ feature_name })),
      };
    });
  });
}

interface WeeklyBlock {
  days: 'MWF' | 'TUTH';
  time: string;
  minutes: number;
  dept: string;
  org: string;
  number: string;
  title: string;
  section: string;
  type: string;
}

function weeklyPlan(space: RawSpace): WeeklyBlock[] {
  const r = rng(`plan-${space.space_name}`);
  const type =
    space.max_capacity >= 100 ? 'Lecture' : space.max_capacity <= 24 ? 'Discussion' : 'Class';
  const blocks: WeeklyBlock[] = [];
  for (const [days, times, minutes] of [
    ['MWF', MWF, 50],
    ['TUTH', TUTH, 75],
  ] as const) {
    for (const time of times) {
      if (r() >= 0.45) continue;
      const [dept, org, list] = pick(r, COURSES);
      const [number, title] = pick(r, list);
      const section = String(1 + Math.floor(r() * 4)).padStart(2, '0');
      blocks.push({ days, time, minutes, dept, org, number, title, section, type });
    }
  }
  return blocks;
}

/** Generated class occurrences overlapping [from, to). */
export function mockReservations(from: Date, to: Date): RawReservation[] {
  const out: RawReservation[] = [];
  const firstDay = formatCampus(from, 'yyyy-MM-dd');
  const lastDay = formatCampus(to, 'yyyy-MM-dd');
  const plans = mockSpaces().map((s) => [s, weeklyPlan(s)] as const);
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
    const set =
      dow === 1 || dow === 3 || dow === 5 ? 'MWF' : dow === 2 || dow === 4 ? 'TUTH' : null;
    if (!set) continue;
    for (const [space, plan] of plans) {
      for (const b of plan) {
        if (b.days !== set) continue;
        const start = campusLocalToUtc(`${day}T${b.time}`);
        const end = new Date(start.getTime() + b.minutes * 60_000);
        if (!overlaps({ start, end }, { start: from, end: to })) continue;
        out.push({
          reservation_id: hashNum(`${space.space_name}-${day}-${b.time}`),
          reservation_start_dt: formatCampus(start, "yyyy-MM-dd'T'HH:mm:ssxxx"),
          reservation_end_dt: formatCampus(end, "yyyy-MM-dd'T'HH:mm:ssxxx"),
          space_id: space.space_id,
          event: {
            event_id: hashNum(`${b.dept}${b.number}-${b.section}-${space.space_name}`),
            event_name: `${b.dept} ${b.number}-${b.section}: ${b.title}`,
            event_type_name: b.type,
            organization_name: b.org,
          },
        });
      }
    }
  }
  return out;
}

export class MockSource implements ScheduleSource {
  readonly name = 'mock';
  constructor(
    private readonly opts: {
      /** false = only injected classes (deterministic tests). */
      generateClasses?: boolean;
      loadInjected?: () => Promise<RawReservation[]>;
    } = {},
  ) {}

  async listBuildings() {
    return [...CAMPUS_BUILDINGS];
  }

  async listRooms(): Promise<SourceRoom[]> {
    return mockSpaces()
      .map(mapSpace)
      .filter((r): r is SourceRoom => r !== null);
  }

  async listEvents(roomIds: readonly string[], from: Date, to: Date): Promise<ClassEvent[]> {
    const rooms = await this.listRooms();
    const bySpace = new Map(rooms.map((r) => [r.twentyFiveLiveId, r.roomId]));
    const raw = [
      ...(this.opts.generateClasses === false ? [] : mockReservations(from, to)),
      ...((await this.opts.loadInjected?.()) ?? []),
    ];
    const wanted = new Set(roomIds);
    return raw
      .map((r) => mapReservation(r, bySpace))
      .filter(
        (e): e is ClassEvent =>
          e !== null && wanted.has(e.roomId) && overlaps(e, { start: from, end: to }),
      );
  }
}
