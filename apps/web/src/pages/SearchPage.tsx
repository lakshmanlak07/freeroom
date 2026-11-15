import type { Equipment, RoomSearchQuery } from '@freeroom/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RotateCcw, SearchX, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, Skeleton } from '@/components/EmptyState';
import { EQUIPMENT } from '@/components/Equipment';
import { RoomCard } from '@/components/RoomCard';
import { PeopleInput } from '@/components/PeopleInput';
import { SearchChips, filtersToParams } from '@/components/SearchChips';
import { Button, inputClass } from '@/components/ui/button';
import { addDays, campusDay, campusLocalToUtc } from '@/lib/time';
import { cn } from '@/lib/utils';

const SORTS: { value: NonNullable<RoomSearchQuery['sort']>; label: string }[] = [
  { value: 'soonestFree', label: 'Soonest free' },
  { value: 'longestFree', label: 'Longest free block' },
  { value: 'capacity', label: 'Capacity' },
];

/** F1: every filter lives in the URL, so results are shareable and survive reloads. */
export function SearchPage() {
  const { api } = useAuth();
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSp(next, { replace: true });
  };

  // Top-bar free text (?nl=…) → parsed filters written into the URL → normal GET /rooms below.
  const nl = get('nl');
  const natural = useQuery({
    queryKey: ['nl', nl],
    queryFn: () => api.naturalSearch(nl),
    enabled: nl.length >= 3,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (natural.data) setSp(filtersToParams(natural.data, nl), { replace: true });
  }, [natural.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = campusDay(new Date());
  const equipment = get('equipment').split(',').filter(Boolean) as Equipment[];
  const date = get('date');
  const from = get('from');
  const to = get('to');
  const windowValid = !!(date && from && to && to > from);
  const params = {
    building: get('building') || undefined,
    minCapacity: Number(get('minCapacity')) || undefined,
    equipment,
    freeNow: get('freeNow') === '1',
    ...(windowValid && {
      freeFrom: campusLocalToUtc(`${date}T${from}`).toISOString(),
      freeTo: campusLocalToUtc(`${date}T${to}`).toISOString(),
    }),
    sort: get('sort') || undefined,
  };

  const buildings = useQuery({
    queryKey: ['buildings'],
    queryFn: api.buildings,
    staleTime: 60_000,
  });
  const rooms = useQuery({
    queryKey: ['rooms', params],
    queryFn: () => api.rooms(params),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const q = get('q').trim().toLowerCase();
  const results = useMemo(
    () =>
      (rooms.data?.rooms ?? []).filter(
        (r) => !q || `${r.name} ${r.buildingName} ${r.buildingId}`.toLowerCase().includes(q),
      ),
    [rooms.data, q],
  );
  const META = ['q', 'nl', 'asked', 'src'];
  const filtersActive = [...sp.keys()].some((k) => !META.includes(k));
  const activeCount = [...sp.keys()].filter((k) => !META.includes(k) && k !== 'sort').length;
  const [showFilters, setShowFilters] = useState(false); // mobile only; always shown ≥ md

  return (
    <div>
      <section className="bg-brand-gradient px-4 pt-8 pb-14 text-white md:px-8 md:pb-16">
        <h1 className="text-3xl font-bold md:text-4xl">Find a free room</h1>
        <p className="mt-1 text-white/90">Live availability across campus · updates every 30s</p>
      </section>

      <div className="space-y-6 px-4 py-6 md:px-8">
        {natural.isFetching ? (
          <p className="text-sm text-muted" aria-live="polite">
            Understanding “{nl}”…
          </p>
        ) : natural.isError ? (
          <p role="alert" className="text-sm text-amber-ink">
            {(natural.error as { code?: string }).code === 'RATE_LIMITED'
              ? 'That’s a lot of searches. Wait a minute, or use the filters below.'
              : 'Couldn’t understand that search. Use the filters below.'}
          </p>
        ) : (
          <SearchChips
            sp={sp}
            set={set}
            buildings={buildings.data?.buildings ?? []}
            onExample={(text) => setSp({ nl: text })}
          />
        )}
        <Button
          variant="outline"
          className="w-full md:hidden"
          aria-expanded={showFilters}
          aria-controls="filters"
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters
          {!!activeCount && (
            <span className="grid min-w-6 place-items-center rounded-full bg-brown px-1.5 text-xs text-white tabular">
              {activeCount}
              <span className="sr-only"> active</span>
            </span>
          )}
        </Button>
        {showFilters && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setShowFilters(false)}
            aria-hidden
          />
        )}
        {/* Phones: a bottom sheet over the results. md+: an inline panel, always shown. */}
        <form
          id="filters"
          aria-label="Filters"
          className={cn(
            'gap-4 border border-line bg-surface p-4 shadow-card md:static md:z-auto md:grid md:max-h-none md:grid-cols-2 md:overflow-visible md:rounded-2xl md:pb-4 xl:grid-cols-4 [&>*]:min-w-0',
            showFilters
              ? 'fixed inset-x-0 bottom-0 z-50 m-0 grid max-h-[85dvh] overflow-y-auto rounded-t-3xl pb-[calc(1rem+env(safe-area-inset-bottom))]'
              : 'hidden',
          )}
          onSubmit={(e) => e.preventDefault()}
          onKeyDown={(e) => e.key === 'Escape' && setShowFilters(false)}
        >
          {showFilters && (
            <div className="flex items-center justify-between md:hidden">
              <h2 className="text-lg font-semibold">Filters</h2>
              <Button type="button" autoFocus onClick={() => setShowFilters(false)}>
                Show rooms
              </Button>
            </div>
          )}
          <label className="text-sm font-medium">
            Building
            <select
              className={`${inputClass} mt-1`}
              value={get('building')}
              onChange={(e) => set({ building: e.target.value })}
            >
              <option value="">All buildings</option>
              {buildings.data?.buildings.map((b) => (
                <option key={b.buildingId} value={b.buildingId}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <PeopleInput
            id="min-capacity"
            label="People"
            value={Number(get('minCapacity')) || null}
            onChange={(n) => set({ minCapacity: n ? String(n) : null })}
            allowEmpty
            placeholder="Any"
          />
          <label className="text-sm font-medium">
            Sort by
            <select
              className={`${inputClass} mt-1`}
              value={get('sort') || 'soonestFree'}
              onChange={(e) =>
                set({ sort: e.target.value === 'soonestFree' ? null : e.target.value })
              }
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              role="switch"
              aria-checked={get('freeNow') === '1'}
              onClick={() => set({ freeNow: get('freeNow') === '1' ? null : '1' })}
              className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-line px-3 text-sm font-medium"
            >
              Free now
              <span
                className={cn(
                  'relative h-6 w-11 rounded-full transition',
                  get('freeNow') === '1' ? 'bg-free' : 'bg-line',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-5 rounded-full bg-surface shadow transition',
                    get('freeNow') === '1' ? 'left-5.5' : 'left-0.5',
                  )}
                />
              </span>
            </button>
          </div>

          <fieldset className="md:col-span-2">
            <legend className="text-sm font-medium">Equipment</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(Object.keys(EQUIPMENT) as Equipment[]).map((e) => {
                const on = equipment.includes(e);
                const { Icon, label } = EQUIPMENT[e];
                return (
                  <button
                    key={e}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        equipment:
                          (on ? equipment.filter((x) => x !== e) : [...equipment, e]).join(',') ||
                          null,
                      })
                    }
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition',
                      on
                        ? 'border-brown bg-brown text-white'
                        : 'border-line bg-surface text-espresso hover:bg-cream',
                    )}
                  >
                    <Icon className="size-4" aria-hidden /> {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="md:col-span-2">
            <legend className="text-sm font-medium">Free during</legend>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
              <input
                aria-label="Date"
                type="date"
                min={today}
                max={addDays(today, 7)}
                className={`${inputClass} col-span-2 tabular sm:col-span-1`}
                value={date}
                onChange={(e) => set({ date: e.target.value })}
              />
              <input
                aria-label="From"
                type="time"
                step={900}
                className={`${inputClass} tabular`}
                value={from}
                onChange={(e) => set({ from: e.target.value, date: date || today })}
              />
              <input
                aria-label="To"
                type="time"
                step={900}
                className={`${inputClass} tabular`}
                value={to}
                onChange={(e) => set({ to: e.target.value, date: date || today })}
              />
            </div>
            {date && from && to && !windowValid && (
              <p className="mt-1 text-xs text-amber-ink">End time must be after start.</p>
            )}
          </fieldset>
        </form>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted" aria-live="polite">
            {rooms.isLoading
              ? 'Loading rooms…'
              : `${results.length} room${results.length === 1 ? '' : 's'}`}
            {rooms.isFetching && !rooms.isLoading && ' · refreshing'}
          </p>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSp(q ? { q } : {}, { replace: true })}
            >
              <RotateCcw className="size-4" aria-hidden /> Clear filters
            </Button>
          )}
        </div>

        {rooms.isError ? (
          <EmptyState
            tone="error"
            icon={TriangleAlert}
            title="Couldn’t load rooms"
            body={rooms.error.message}
            action={<Button onClick={() => void rooms.refetch()}>Try again</Button>}
          />
        ) : rooms.isLoading ? (
          <ul
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
            aria-busy="true"
            aria-label="Loading rooms"
          >
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i}>
                <Skeleton className="h-40" />
              </li>
            ))}
          </ul>
        ) : results.length ? (
          <>
            <h2 id="results-h" className="sr-only">
              Results
            </h2>
            <ul
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              aria-labelledby="results-h"
            >
              {results.map((r) => (
                <RoomCard key={r.roomId} room={r} />
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            icon={SearchX}
            title="No rooms match"
            body="Try fewer equipment filters, a smaller capacity, or a different time."
            action={
              filtersActive || q ? (
                <Button variant="outline" onClick={() => setSp({}, { replace: true })}>
                  Clear all
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
