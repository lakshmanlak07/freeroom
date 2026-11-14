/** F3: campus map. MapLibre GL + Amazon Location (API key) — or a free OSM style in mock/local mode. */
import { distanceMeters } from '@freeroom/domain';
import type { Building } from '@freeroom/shared';
import { useQuery } from '@tanstack/react-query';
import { List, LocateFixed, MapPin } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, Skeleton } from '@/components/EmptyState';
import { RoomCard } from '@/components/RoomCard';
import { Button } from '@/components/ui/button';
import { useConfig } from '@/config';
import { cn } from '@/lib/utils';

const CENTER: [number, number] = [-72.5276, 42.3918];
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Color AND text label (the % is printed on the marker) — never color alone. */
export const tier = (pct: number) =>
  pct >= 60
    ? { label: 'Mostly free', color: '#2e8b57' }
    : pct >= 30
      ? { label: 'Some free', color: '#c77700' }
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

  // Init once. Amazon Location when deployed (key restricted to map reads on our origins).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const useLocation =
        import.meta.env.VITE_USE_MOCKS !== 'true' && config.mapApiKey && config.mapName;
      const opts: maplibregl.MapOptions = useLocation
        ? {
            container: mapEl.current!,
            style: `https://maps.geo.${config.region}.amazonaws.com/maps/v0/maps/${config.mapName}/style-descriptor`,
            // The key is restricted to map reads from our origins; it rides on every Location request.
            transformRequest: (url: string) =>
              url.startsWith(`https://maps.geo.${config.region}.amazonaws.com`)
                ? {
                    url: `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(config.mapApiKey!)}`,
                  }
                : { url },
          }
        : { container: mapEl.current!, style: OSM_STYLE };
      if (cancelled) return;
      map.current = new maplibregl.Map({
        ...opts,
        center: CENTER,
        zoom: 15.4,
        attributionControl: { compact: true },
      });
      map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [config]);

  // Markers are real <button>s: focusable, labelled, keyboard-activatable.
  useEffect(() => {
    if (!map.current) return;
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
  }, [buildings.data, selected, map.current]); // eslint-disable-line react-hooks/exhaustive-deps

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
      </section>

      <aside
        className="space-y-4 overflow-y-auto border-l border-line bg-cream p-4"
        aria-label="Buildings and rooms"
      >
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
