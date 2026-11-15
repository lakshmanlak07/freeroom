/**
 * Natural-language search results as editable chips ("Capacity ≥ 6 ✕", "Projector ✕", …), the
 * "Understood by AI" / "Smart search" label, and example chips under an empty search. Filters live
 * in the URL (same params as the filter panel), so removing a chip just deletes its params.
 */
import type { Building, Equipment, NaturalSearchResponse } from '@freeroom/shared';
import { Sparkles, Wand2, X } from 'lucide-react';
import { useState } from 'react';
import { EQUIPMENT } from '@/components/Equipment';
import { checkPeople } from '@/components/PeopleInput';
import { campusDay, campusLocalToUtc, fmtDay, fmtRange, formatCampus } from '@/lib/time';

export const EXAMPLES = [
  'Room for 6 with a projector near the library at 3pm',
  'Whiteboard room in LGRT tomorrow 2 to 4',
  'Free now for 4 with outlets',
];

/** API filters → URL params (campus-local date/from/to, like the filter panel). */
export function filtersToParams(r: NaturalSearchResponse, asked: string) {
  const f = r.filters;
  const p = new URLSearchParams();
  if (f.building) p.set('building', f.building);
  if (f.minCapacity) p.set('minCapacity', String(f.minCapacity));
  if (f.equipment?.length) p.set('equipment', f.equipment.join(','));
  if (f.freeNow) p.set('freeNow', '1');
  if (f.freeFrom && f.freeTo) {
    p.set('date', campusDay(new Date(f.freeFrom)));
    p.set('from', formatCampus(new Date(f.freeFrom), 'HH:mm'));
    p.set('to', formatCampus(new Date(f.freeTo), 'HH:mm'));
  }
  p.set('src', r.source);
  p.set('asked', asked);
  return p;
}

interface Props {
  sp: URLSearchParams;
  set: (patch: Record<string, string | null>) => void;
  buildings: Building[];
  onExample: (text: string) => void;
}

export function SearchChips({ sp, set, buildings, onExample }: Props) {
  const get = (k: string) => sp.get(k) ?? '';
  const equipment = get('equipment').split(',').filter(Boolean) as Equipment[];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [capError, setCapError] = useState<string | null>(null);
  const chips: { key: string; label: string; clear: Record<string, string | null> }[] = [];
  if (get('minCapacity')) {
    chips.push({
      key: 'cap',
      label: `Capacity ≥ ${get('minCapacity')}`,
      clear: { minCapacity: null },
    });
  }
  for (const e of equipment) {
    const rest = equipment.filter((x) => x !== e).join(',') || null;
    chips.push({ key: `eq-${e}`, label: EQUIPMENT[e]?.label ?? e, clear: { equipment: rest } });
  }
  if (get('building')) {
    chips.push({
      key: 'bldg',
      label: buildings.find((b) => b.buildingId === get('building'))?.name ?? get('building'),
      clear: { building: null },
    });
  }
  if (get('date') && get('from') && get('to')) {
    const day = get('date');
    const range = fmtRange(
      campusLocalToUtc(`${day}T${get('from')}`),
      campusLocalToUtc(`${day}T${get('to')}`),
    );
    chips.push({
      key: 'time',
      label: day === campusDay(new Date()) ? range : `${fmtDay(day)} · ${range}`,
      clear: { date: null, from: null, to: null },
    });
  }
  if (get('freeNow') === '1') {
    chips.push({ key: 'now', label: 'Free now', clear: { freeNow: null } });
  }

  const src = get('src');
  if (!chips.length && !get('asked')) {
    return (
      <div className="flex flex-wrap items-center gap-2" aria-label="Example searches">
        <span className="text-sm text-muted">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onExample(ex)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-espresso hover:border-brown hover:bg-cream"
          >
            {ex}
          </button>
        ))}
      </div>
    );
  }
  if (!src) return null; // filters set by hand: the filter panel already shows them

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Search filters">
      <span className="inline-flex items-center gap-1 rounded-full bg-plum-50 px-2.5 py-1 text-xs font-semibold text-plum">
        {src === 'bedrock' ? (
          <Sparkles className="size-3.5" aria-hidden />
        ) : (
          <Wand2 className="size-3.5" aria-hidden />
        )}
        {src === 'bedrock' ? 'Understood by AI' : 'Smart search'}
      </span>
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 rounded-full border border-brown/30 bg-surface py-1 pr-1 pl-3 text-sm font-medium text-espresso"
        >
          {c.key === 'cap' && editing ? (
            <span className="inline-flex items-center gap-1">
              <label htmlFor="chip-capacity">Capacity ≥</label>
              <input
                id="chip-capacity"
                autoFocus
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={draft}
                aria-invalid={!!capError}
                aria-describedby={capError ? 'chip-capacity-error' : undefined}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setCapError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(false);
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                onBlur={() => {
                  const r = checkPeople(draft);
                  if (!r.ok) return setCapError(r.error);
                  set({ minCapacity: String(r.value) });
                  setEditing(false);
                }}
                className="h-8 w-16 rounded-lg border border-line px-2 text-center text-base tabular"
              />
              {capError && (
                <span id="chip-capacity-error" role="alert" className="text-xs text-amber-ink">
                  {capError}
                </span>
              )}
            </span>
          ) : c.key === 'cap' ? (
            <button
              type="button"
              className="rounded-full hover:underline"
              aria-label={`${c.label}, edit people count`}
              onClick={() => {
                setDraft(get('minCapacity'));
                setEditing(true);
              }}
            >
              {c.label}
            </button>
          ) : (
            c.label
          )}
          <button
            type="button"
            onClick={() => set({ ...c.clear })}
            aria-label={`Remove ${c.label}`}
            className="grid size-6 place-items-center rounded-full text-muted hover:bg-cream hover:text-espresso"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      {!chips.length && (
        <span className="text-sm text-muted">
          No filters recognised in “{get('asked')}”, so all rooms are shown.
        </span>
      )}
    </div>
  );
}
