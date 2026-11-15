/** Attendee initials (from aliases, never real names) with a +N overflow. */
import { cn } from '@/lib/utils';

const initials = (alias: string) =>
  alias
    .replace(/^(Prof|Dr)\.\s*/, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
// Tinted chips with their ink tokens: AA contrast in light and dark.
const HUES = [
  'bg-plum-50 text-plum',
  'bg-slate-50 text-slate',
  'bg-free-50 text-free-ink',
  'bg-amber/15 text-amber-ink',
];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length]!;

/** Initial circles from aliases (never real names), with a "+N" overflow. */
export function Avatars({ names, max = 5 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  return (
    <ul className="flex -space-x-2" aria-label={`Going: ${names.join(', ')}`}>
      {shown.map((n, i) => (
        <li
          key={`${n}-${i}`}
          title={n}
          className={cn(
            'grid size-9 place-items-center rounded-full text-xs font-bold ring-2 ring-surface',
            hue(n),
          )}
        >
          <span aria-hidden>{initials(n)}</span>
        </li>
      ))}
      {more > 0 && (
        <li className="grid size-9 place-items-center rounded-full bg-line text-xs font-bold ring-2 ring-surface">
          +{more}
        </li>
      )}
    </ul>
  );
}
