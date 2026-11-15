/**
 * Draws a walking route on a MapLibre map: a thick brand-accent line over a subtle casing, an
 * ~800 ms draw-on (skipped under reduced motion), a pulsing "you are here" dot and a door pin at
 * the entrance. Colors come from CSS tokens so dark mode restyles it. Returns a cleanup.
 */
import type { RouteResponse } from '@freeroom/shared';
import * as maplibregl from 'maplibre-gl';

const SRC = 'fr-route';
const DRAW_MS = 800;
const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** The first `t` (0..1) of a polyline, by length. */
export function slice(coords: [number, number][], t: number): [number, number][] {
  if (t >= 1 || coords.length < 2) return coords;
  const seg = coords.slice(1).map((c, i) => Math.hypot(c[0] - coords[i]![0], c[1] - coords[i]![1]));
  let left = seg.reduce((a, b) => a + b, 0) * t;
  const out: [number, number][] = [coords[0]!];
  for (let i = 0; i < seg.length; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    if (left >= seg[i]!) {
      out.push(b);
      left -= seg[i]!;
      continue;
    }
    const f = seg[i]! ? left / seg[i]! : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    break;
  }
  return out;
}

const DOOR_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20H2"/><path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/></svg>';

export function drawRoute(
  m: maplibregl.Map,
  r: RouteResponse,
  o: { reducedMotion: boolean; padding: maplibregl.PaddingOptions; onDrawn?: () => void },
) {
  const coords = r.geometry.coordinates;
  const line = (c: [number, number][]) => ({
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: c },
  });
  m.addSource(SRC, {
    type: 'geojson',
    data: line(o.reducedMotion ? coords : coords.slice(0, 1)),
  });
  const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
  m.addLayer({
    id: `${SRC}-casing`,
    type: 'line',
    source: SRC,
    layout,
    paint: {
      'line-color': token('--color-route-casing', '#ffffff'),
      'line-width': 11,
      'line-opacity': 0.95,
    },
  });
  m.addLayer({
    id: `${SRC}-line`,
    type: 'line',
    source: SRC,
    layout,
    paint: { 'line-color': token('--color-route', '#7b3f00'), 'line-width': 6 },
  });

  const me = document.createElement('div');
  me.className = 'fr-me';
  me.setAttribute('aria-hidden', 'true');
  const door = document.createElement('div');
  door.className = 'fr-door';
  door.setAttribute('aria-hidden', 'true');
  door.innerHTML = DOOR_SVG;
  const meMarker = new maplibregl.Marker({ element: me })
    .setLngLat([r.origin.lng, r.origin.lat])
    .addTo(m);
  const doorMarker = new maplibregl.Marker({ element: door, anchor: 'bottom' })
    .setLngLat([r.destinationEntrance.lng, r.destinationEntrance.lat])
    .addTo(m);

  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0]!, coords[0]!),
  );
  m.fitBounds(bounds, { padding: o.padding, duration: o.reducedMotion ? 0 : 600, maxZoom: 17.5 });

  let raf = 0;
  let cancelled = false;
  const src = () => m.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
  if (o.reducedMotion) {
    m.once('idle', () => !cancelled && o.onDrawn?.());
  } else {
    m.once('moveend', () => {
      if (cancelled) return;
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / DRAW_MS);
        src()?.setData(line(slice(coords, 1 - (1 - k) ** 3))); // ease-out
        if (k < 1) raf = requestAnimationFrame(step);
        else o.onDrawn?.();
      };
      raf = requestAnimationFrame(step);
    });
  }

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
    meMarker.remove();
    doorMarker.remove();
    for (const id of [`${SRC}-line`, `${SRC}-casing`]) if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource(SRC)) m.removeSource(SRC);
  };
}

/** Route vertices in viewport pixels (for the fox's trot along the line). */
export function screenPath(m: maplibregl.Map, r: RouteResponse) {
  const box = m.getContainer().getBoundingClientRect();
  return r.geometry.coordinates.map((c) => {
    const p = m.project(c);
    return { x: box.left + p.x, y: box.top + p.y };
  });
}
