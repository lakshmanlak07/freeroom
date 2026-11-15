/**
 * Map style selection. Deployed: Amazon Location Maps API v2 (no map resource; the API key rides
 * on the style URL and the style embeds it in its tile URLs). Mock/local without a key: free OSM
 * raster tiles. Pure so it can be unit-tested.
 */
import type { StyleSpecification } from 'maplibre-gl';

export type ColorScheme = 'Light' | 'Dark';

/** https://maps.geo.{region}.amazonaws.com/v2/styles/Standard/descriptor?key=…&color-scheme=… */
export function locationStyleUrl(o: { region: string; apiKey: string; scheme?: ColorScheme }) {
  const u = new URL(`https://maps.geo.${o.region}.amazonaws.com/v2/styles/Standard/descriptor`);
  u.searchParams.set('key', o.apiKey);
  u.searchParams.set('color-scheme', o.scheme ?? 'Light');
  return u.toString();
}

export const OSM_STYLE: StyleSpecification = {
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

/** Location when deployed with a key (and not in mock mode), else the OSM fallback. */
export function mapStyleFor(
  config: { region: string; mapApiKey?: string },
  o: { mocks: boolean; scheme?: ColorScheme },
): string | StyleSpecification {
  return !o.mocks && config.mapApiKey
    ? locationStyleUrl({ region: config.region, apiKey: config.mapApiKey, scheme: o.scheme })
    : OSM_STYLE;
}

/** For logs: never print the API key. */
export const redactKey = (s: string) => s.replace(/([?&]key=)[^&\s"]+/g, '$1<redacted>');

/**
 * Amazon Location Maps v2 static image (GetStaticMap — the API key already allows it) with a pin
 * at `p`. null without a key (local/mock mode): callers show an illustrated fallback.
 */
export function staticMapUrl(
  config: { region: string; mapApiKey?: string },
  p: { lat: number; lng: number },
  o: { width: number; height: number; scheme?: ColorScheme; zoom?: number },
) {
  if (!config.mapApiKey) return null;
  const q = new URLSearchParams({
    center: `${p.lng},${p.lat}`,
    zoom: String(o.zoom ?? 16),
    width: String(o.width),
    height: String(o.height),
    style: 'Standard',
    'color-scheme': o.scheme ?? 'Light',
    'compact-overlay': `point:${p.lng},${p.lat};color=#7B3F00;size=large`,
    key: config.mapApiKey,
  });
  return `https://maps.geo.${config.region}.amazonaws.com/v2/static/map@2x?${q}`;
}
