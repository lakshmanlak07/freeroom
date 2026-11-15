/**
 * Typeable people count with −/+ steppers. Text input (inputMode=numeric) so phones show the
 * number pad and desktop users can type "24" instead of dragging a slider. Validates on blur and
 * Enter; only valid numbers reach `onChange`, and `onValidChange` lets the form block submit.
 */
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export const PEOPLE_MAX = 500;

export type PeopleCheck = { ok: true; value: number | null } | { ok: false; error: string };

/** Pure so it's unit-testable. Empty means "any" only when `allowEmpty`. */
export function checkPeople(
  draft: string,
  { min = 1, max = PEOPLE_MAX, allowEmpty = false } = {},
): PeopleCheck {
  const s = draft.trim();
  if (!s) return allowEmpty ? { ok: true, value: null } : { ok: false, error: 'Enter a number.' };
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Use whole numbers only.' };
  const n = Number(s);
  if (n < min) return { ok: false, error: `At least ${min}.` };
  if (n > max)
    return { ok: false, error: `At most ${max}${max < PEOPLE_MAX ? ' (room seats)' : ''}.` };
  return { ok: true, value: n };
}

interface Props {
  id: string;
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  onValidChange?: (ok: boolean) => void;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
}

const stepBtn =
  'grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-espresso hover:bg-cream disabled:opacity-40';

export function PeopleInput({
  id,
  label,
  value,
  onChange,
  onValidChange,
  min = 1,
  max = PEOPLE_MAX,
  allowEmpty = false,
  placeholder,
  hint,
  className,
}: Props) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  // Follow outside changes (URL param, chip removal) without clobbering an invalid draft.
  useEffect(() => {
    setDraft((d) =>
      checkPeople(d, { min, max, allowEmpty }).ok ? (value == null ? '' : String(value)) : d,
    );
  }, [value, min, max, allowEmpty]);

  const commit = (s: string) => {
    const r = checkPeople(s, { min, max, allowEmpty });
    setError(r.ok ? null : r.error);
    onValidChange?.(r.ok);
    if (r.ok && r.value !== value) onChange(r.value);
    return r.ok;
  };
  const step = (d: number) => {
    const cur = /^\d+$/.test(draft.trim()) ? Number(draft) : d > 0 ? min - 1 : min;
    const next = String(Math.min(max, Math.max(min, cur + d)));
    setDraft(next);
    commit(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(e.key === 'ArrowUp' ? 1 : -1);
    } else if (e.key === 'Enter' && !commit(draft)) {
      e.preventDefault(); // keep the form from submitting an invalid count
    }
  };

  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  const n = Number(draft);
  return (
    <div className={cn('text-sm font-medium', className)}>
      <label htmlFor={id}>{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          className={stepBtn}
          aria-label={`Fewer: ${label}`}
          aria-controls={id}
          disabled={!!draft && n <= min}
          onClick={() => step(-1)}
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={draft}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => commit(draft)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-11 w-full min-w-0 rounded-xl border bg-surface px-3 text-center text-base text-espresso tabular placeholder:text-muted/70',
            error ? 'border-amber-ink' : 'border-line',
          )}
        />
        <button
          type="button"
          className={stepBtn}
          aria-label={`More: ${label}`}
          aria-controls={id}
          disabled={n >= max}
          onClick={() => step(1)}
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs font-normal text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-semibold text-amber-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
