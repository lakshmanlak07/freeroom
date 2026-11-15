/** F3: campus map. MapLibre GL + Amazon Location Maps v2 (API key) — or free OSM in mock/local mode. */
import { distanceMeters } from '@freeroom/domain';
import type { Building } from '@freeroom/shared';
import { useQuery } from '@tanstack/react-query';
import { List, LocateFixed, MapPin, RotateCcw, TriangleAlert } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre v6 otherwise resolves its worker relative to the bundled chunk, a file Vite never
// emits (403 on CloudFront → blank map). Ship it as a hashed asset and point maplibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, Skeleton } from '@/components/EmptyState';
import { RoomCard } from '@/components/RoomCard';
import { Button } from '@/components/ui/button';
import { useConfig } from '@/config';
import { mapStyleFor, redactKey } from '@/lib/mapStyle';
import { cn } from '@/lib/utils';

maplibregl.setWorkerUrl(workerUrl);
const CENTER: [number, number] = [-72.5276, 42.3918];
const STYLE_TIMEOUT_MS = 8000;

/** Color AND text label (the % is printed on the marker) — never color alone. */
export const tier = (pct: number) =>
  pct >= 60
    ? { label: 'Mostly free', color: '#1e6b45' } // white text ≥ 4.5:1 (WCAG AA) on every tier
    : pct >= 30
      ? { label: 'Some free', color: '#8a5300' }
      : { label: 'Busy', color: '#8b2c2c' };

export default function MapPage() {
  const { api } = useAuth();
  const config = useConfig();
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const buildings = useQuery({
    queryKey: ['buildings'],
    queryFn: api.buildings,
    refetchInterval: 15_000,
  });
  const rooms = useQuery({
    queryKey: ['rooms', { building: selected }],
    queryFn: () => api.rooms({ building: selected! }),
    enabled: !!selected,
    refetchInterval: 15_000,
  });
  const list = useMemo(() => {
    const bs = buildings.data?.buildings ?? [];
    return me ? [...bs].sort((a, b) => distanceMeters(me, a) - distanceMeters(me, b)) : bs;
  }, [buildings.data, me]);
  const current = list.find((b) => b.buildingId === selected);

  // Init (and re-init on Retry). Amazon Location v2 when deployed; the key is restricted to
  // geo-maps reads from our origins and rides on the style URL.
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = mapEl.current!;
    setReady(false);
    setFailed(false);
    const m = new maplibregl.Map({
      container: el,
      style: mapStyleFor(config, { mocks: import.meta.env.VITE_USE_MOCKS === 'true' }),
      center: CENTER,
      zoom: 15.4,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const timer = setTimeout(() => {
      if (!m.isStyleLoaded()) {
        setFailed(true);
        setShowList(true); // the buildings list stays fully usable without the map
      }
    }, STYLE_TIMEOUT_MS);
    m.once('load', () => {
      clearTimeout(timer);
      m.resize();
      setReady(true);
    });
    m.on('error', (e) => {
      const msg = e.error?.message ?? String(e.error ?? 'map error');
      console.error('[map]', redactKey(msg)); // never log the API key
    });
    // The side panel / route mount can change the container size after init.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, [config, attempt]);

  // Markers are real <button>s: focusable, labelled, keyboard-activatable. Added once the style
  // has loaded, re-added when the data or selection changes.
  useEffect(() => {
    if (!map.current || !ready) return;
    markers.current.forEach((m) => m.remove());
    markers.current = (buildings.data?.buildings ?? []).map((b) => {
      const el = document.createElement('button');
      const t = tier(b.freePct);
      el.type = 'button';
      el.className = cn(
        'grid size-11 place-items-center rounded-full border-[3px] border-white text-[11px] font-bold text-white shadow-lg',
        selected === b.buildingId && 'outline-4 outline-offset-2 outline-gold',
      );
      el.style.background = t.color;
      el.textContent = `${b.freePct}%`;
      el.setAttribute('aria-label', `${b.name}: ${b.freePct}% of rooms free (${t.label})`);
      el.setAttribute('aria-pressed', String(selected === b.buildingId));
      el.onclick = () => select(b);
      return new maplibregl.Marker({ element: el }).setLngLat([b.lng, b.lat]).addTo(map.current!);
    });
  }, [buildings.data, selected, ready]);

  const select = (b: Building) => {
    setSelected(b.buildingId);
    map.current?.flyTo({ center: [b.lng, b.lat], zoom: 16.5 });
  };

  /** Opt-in; the position never leaves the browser. */
  const nearMe = () => {
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const p = { lat: coords.latitude, lng: coords.longitude };
        setMe(p);
        const dot = document.createElement('div');
        dot.className = 'size-4 rounded-full border-2 border-white bg-slate shadow';
        dot.setAttribute('aria-hidden', 'true');
        new maplibregl.Marker({ element: dot }).setLngLat([p.lng, p.lat]).addTo(map.current!);
        map.current?.flyTo({ center: [p.lng, p.lat], zoom: 16 });
      },
      () => setGeoError('Location is off or blocked — you can still pick a building.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="grid lg:h-[calc(100dvh-65px)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <section className="relative h-[55dvh] lg:h-full" aria-label="Campus map">
        {/* h-full, not absolute: maplibre's CSS forces .maplibregl-map { position: relative }. */}
        <div ref={mapEl} className="h-full w-full" />
        <div className="absolute top-3 left-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={nearMe} className="shadow-card">
            <LocateFixed className="size-4" aria-hidden /> Near me
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showList}
            onClick={() => setShowList((v) => !v)}
            className="shadow-card"
          >
            <List className="size-4" aria-hidden /> Buildings list
          </Button>
        </div>
        <ul
          className="absolute bottom-6 left-3 space-y-1 rounded-xl bg-white/95 p-3 text-xs shadow-card"
          aria-label="Legend"
        >
          {[80, 45, 10].map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span
                className="size-3 rounded-full"
                style={{ background: tier(p).color }}
                aria-hidden
              />
              {tier(p).label} ({p >= 60 ? '≥ 60%' : p >= 30 ? '30–59%' : '< 30%'} rooms free)
            </li>
          ))}
        </ul>
        {geoError && (
          <p
            role="status"
            className="absolute top-14 left-3 rounded-lg bg-white px-3 py-2 text-xs text-amber-ink shadow-card"
          >
            {geoError}
          </p>
        )}
        {failed && (
          <div
            role="alert"
            className="absolute inset-x-3 top-1/3 mx-auto max-w-sm rounded-2xl border border-line bg-white p-4 text-center shadow-card"
          >
            <TriangleAlert className="mx-auto size-6 text-amber-ink" aria-hidden />
            <p className="mt-2 font-semibold">The map didn’t load</p>
            <p className="mt-1 text-sm text-muted">
              Every building is still in the Buildings list. You can try the map again.
            </p>
            <Button className="mt-3" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCcw className="size-4" aria-hidden /> Retry
            </Button>
          </div>
        )}
      </section>

      <aside
        className="relative z-10 -mt-5 space-y-4 overflow-y-auto rounded-t-3xl border-line bg-cream p-4 shadow-[0_-8px_24px_-12px_rgb(43_26_14/0.25)] lg:mt-0 lg:rounded-none lg:border-l lg:shadow-none"
        aria-label="Buildings and rooms"
      >
        <div aria-hidden className="mx-auto -mt-1 h-1.5 w-10 rounded-full bg-line lg:hidden" />
        {showList && (
          <nav aria-label="Buildings list">
            <h2 className="mb-2 text-sm font-semibold">Buildings{me ? ' · nearest first' : ''}</h2>
            <ul className="space-y-1">
              {list.map((b) => (
                <li key={b.buildingId}>
                  <button
                    type="button"
                    onClick={() => select(b)}
                    aria-pressed={selected === b.buildingId}
                    className="flex w-full items-center justify-between rounded-xl bg-white px-3 py-2 text-left text-sm shadow-card"
                  >
                    <span className="min-w-0 truncate">{b.name}</span>
                    <span
                      className="shrink-0 font-semibold tabular"
                      style={{ color: tier(b.freePct).color }}
                    >
                      {b.freePct}% free
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {!current ? (
          buildings.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <EmptyState
              icon={MapPin}
              title="Pick a building"
              body="Tap a marker (or use the Buildings list) to see its rooms and live status."
            />
          )
        ) : (
          <div>
            <h2 className="text-xl font-bold">{current.name}</h2>
            <p className="text-sm text-muted tabular">
              {current.freePct}% of {current.roomCount} rooms free now
            </p>
            {rooms.isLoading ? (
              <Skeleton className="mt-3 h-40" />
            ) : (
              <ul className="mt-3 grid gap-3">
                {rooms.data?.rooms.map((r) => (
                  <RoomCard key={r.roomId} room={r} />
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
