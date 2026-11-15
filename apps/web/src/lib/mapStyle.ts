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
