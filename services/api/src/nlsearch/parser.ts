/**
 * Deterministic natural-language → room filters (always available; the Bedrock path falls back
 * here). Pure: `now` is injected. Unknown words are ignored, so text like "ignore instructions and
 * book" can only ever produce filters, never actions. Output = the GET /rooms filter object.
 */
import { addDays, campusDay, campusLocalToUtc } from '@freeroom/domain';
import { RoomSearchQuerySchema, type Equipment, type RoomSearchQuery } from '@freeroom/shared';

export interface CatalogBuilding {
  buildingId: string;
  name: string;
}
export interface ParseCtx {
  now: Date;
  buildings: readonly CatalogBuilding[];
}

const TZ = 'America/New_York';
const EQUIPMENT: [Equipment, RegExp][] = [
  ['projector', /\bprojectors?\b/],
  ['whiteboard', /\b(?:white ?boards?|chalk ?boards?|dry[- ]erase)\b/],
  ['computers', /\b(?:computers?|pcs|computer lab)\b/],
  ['outlets', /\b(?:outlets?|power|plugs?|charg(?:e|ing))\b/],
  ['accessible', /\b(?:accessib(?:le|ility)|wheelchair|ada)\b/],
];
// prettier-ignore
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const GENERIC =
  /\b(?:building|hall|center|centre|laboratory|library|school of management|graduate research|tower|w e b)\b/g;
const NOT_A_NAME = new Set(['computer', 'integrative', 'science', 'learning', 'graduate']);
// prettier-ignore
const COMMON_WORDS = new Set(['has', 'is', 'in', 'on', 'at', 'by', 'for', 'and', 'the', 'all', 'any', 'can', 'big', 'now']);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "lgrt", "lederle", "du bois", "dubois", "library", "isenberg", … from the live catalog. */
export function buildingAliases(b: CatalogBuilding): string[] {
  const name = b.name.toLowerCase();
  const plain = name.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const core = plain.replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
  const id = b.buildingId.toLowerCase();
  const out = new Set([plain, ...(COMMON_WORDS.has(id) ? [] : [id])]); // "HAS" ≠ "has a projector"
  if (core.length >= 3) out.add(core).add(core.replace(/\s/g, ''));
  const first = core.split(' ')[0] ?? '';
  if (first.length >= 5 && !NOT_A_NAME.has(first)) out.add(first);
  if (/\blibrary\b/.test(name)) out.add('library');
  return [...out];
}

function matchBuilding(text: string, buildings: readonly CatalogBuilding[]) {
  const all = buildings
    .flatMap((b) => buildingAliases(b).map((a) => [a, b.buildingId] as const))
    .sort((x, y) => y[0].length - x[0].length); // longest alias wins
  return all.find(([a]) => new RegExp(`\\b${escape(a)}\\b`).test(text))?.[1];
}

function matchCapacity(text: string): number | undefined {
  const num = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;
  const notTime = `(?!\\s*(?::|am|pm|a\\.m|p\\.m|o'?clock))`;
  const m =
    text.match(new RegExp(`\\b(?:for|group of|party of|seats?)\\s+${num}\\b${notTime}`)) ??
    text.match(new RegExp(`\\b${num}\\s*(?:people|persons?|students?|seats?|ppl|pax|of us)\\b`));
  if (!m) return undefined;
  const n = Number(m[1]) || NUMBER_WORDS[m[1]!];
  return n && n >= 1 && n <= 500 ? n : undefined;
}

interface Clock {
  h: number;
  m: number;
  explicit: boolean; // had am/pm, or a 24h hour
}
const T = '(noon|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.?|p\\.m\\.?)?)';
function toClock(token: string): Clock | undefined {
  if (token === 'noon') return { h: 12, m: 0, explicit: true };
  const m = token.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (h > 23 || min > 59) return undefined;
  if (ap === 'p' && h < 12) h += 12;
  else if (ap === 'a' && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 6) h += 12; // "at 3" on a campus means 3 PM
  return { h, m: min, explicit: !!ap || h > 12 };
}
const hhmm = (c: Clock) => `${String(c.h).padStart(2, '0')}:${String(c.m).padStart(2, '0')}`;

function campusClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'long',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    h: Number(get('hour')),
    m: Number(get('minute')),
    weekday: get('weekday').toLowerCase(),
  };
}

function matchDay(text: string, now: Date): string | undefined {
  const today = campusDay(now);
  if (/\btomorrow\b/.test(text)) return addDays(today, 1);
  if (/\b(?:today|tonight|this (?:afternoon|evening|morning))\b/.test(text)) return today;
  const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(text));
  if (wd < 0) return undefined;
  const cur = WEEKDAYS.indexOf(campusClock(now).weekday);
  return addDays(today, (wd - cur + 7) % 7);
}

function matchWindow(text: string, now: Date): Pick<RoomSearchQuery, 'freeFrom' | 'freeTo'> {
  const sep = '(?:-|–|to|until|till|til|and)';
  // A range needs "from/between" or an explicit first time, so "for 4 until 5" keeps 4 as people.
  const TX = '(noon|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.?|p\\.m\\.?)|\\d{1,2}:\\d{2})';
  const range =
    text.match(new RegExp(`\\b(?:from|between)\\s+${T}\\s*${sep}\\s*${T}`)) ??
    text.match(new RegExp(`\\b${TX}\\s*${sep}\\s*${T}`));
  let start: Clock | undefined;
  let end: Clock | undefined;
  if (range) {
    start = toClock(range[1]!.trim());
    end = toClock(range[2]!.trim());
  } else {
    const s =
      text.match(new RegExp(`\\b(?:at|from|after|starting(?: at)?|around)\\s+${T}`)) ??
      text.match(/\b(noon|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?))/);
    const e = text.match(new RegExp(`\\b(?:until|till|til|before|by)\\s+${T}`));
    start = s ? toClock(s[1]!.trim()) : undefined;
    end = e ? toClock(e[1]!.trim()) : undefined;
  }
  if (!start && !end) return {};
  // "tonight at 7" / "this evening until 9" → PM.
  if (/\b(?:tonight|evening)\b/.test(text)) {
    const pm = (c?: Clock) => (c && !c.explicit && c.h < 12 ? { ...c, h: c.h + 12 } : c);
    start = pm(start);
    end = pm(end);
  }
  // "3 to 5" → both PM; "10 to 2" → 10 AM–2 PM.
  if (start && end && !end.explicit && end.h <= start.h && end.h + 12 < 24) {
    end = { ...end, h: end.h + 12 };
  }

  const today = campusDay(now);
  const clock = campusClock(now);
  const nowMins = clock.h * 60 + clock.m;
  // "at 3pm" asked after 3pm today (no day word) means tomorrow.
  const day =
    matchDay(text, now) ?? (start && start.h * 60 + start.m <= nowMins ? addDays(today, 1) : today);

  const from = start
    ? campusLocalToUtc(`${day}T${hhmm(start)}`)
    : day === today
      ? now
      : campusLocalToUtc(`${day}T07:00`);
  const to = end ? campusLocalToUtc(`${day}T${hhmm(end)}`) : new Date(from.getTime() + 60 * 60_000); // "at 3pm" = free for an hour from 3
  if (to <= from || to.getTime() - from.getTime() > 24 * 3_600_000) return {};
  return { freeFrom: from.toISOString(), freeTo: to.toISOString() };
}

/** Free text → validated GET /rooms filters. Never throws for any input string. */
export function parseQuery(query: string, ctx: ParseCtx): RoomSearchQuery {
  const text = ` ${query.toLowerCase().replace(/\s+/g, ' ')} `;
  const equipment = EQUIPMENT.filter(([, re]) => re.test(text)).map(([e]) => e);
  const window = matchWindow(text, ctx.now);
  const freeNow = !window.freeFrom && /\b(?:now|right now|currently|asap)\b/.test(text);
  const building = matchBuilding(text, ctx.buildings);
  const minCapacity = matchCapacity(text);
  return RoomSearchQuerySchema.parse({
    ...(building && { building }),
    ...(minCapacity && { minCapacity }),
    ...(equipment.length && { equipment: equipment.join(',') }),
    ...(freeNow && { freeNow: 'true' }),
    ...window,
  });
}
