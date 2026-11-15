import { describe, expect, it } from 'vitest';
import { OSM_STYLE, locationStyleUrl, mapStyleFor, redactKey } from './mapStyle';

describe('map style (config → style)', () => {
  it('builds the Amazon Location Maps v2 Standard style URL with key + color scheme', () => {
    expect(locationStyleUrl({ region: 'us-east-2', apiKey: 'v1.public.abc', scheme: 'Dark' })).toBe(
      'https://maps.geo.us-east-2.amazonaws.com/v2/styles/Standard/descriptor?key=v1.public.abc&color-scheme=Dark',
    );
    expect(locationStyleUrl({ region: 'us-east-2', apiKey: 'k' })).toContain('color-scheme=Light');
  });

  it('uses Location only when deployed with a key, else the OSM fallback', () => {
    const deployed = { region: 'us-east-2', mapApiKey: 'v1.public.abc' };
    expect(mapStyleFor(deployed, { mocks: false })).toMatch(/^https:\/\/maps\.geo\.us-east-2/);
    expect(mapStyleFor(deployed, { mocks: true })).toBe(OSM_STYLE);
    expect(mapStyleFor({ region: 'us-east-2' }, { mocks: false })).toBe(OSM_STYLE);
  });

  it('never leaks the key into logs', () => {
    expect(redactKey('GET https://x/tiles/1/2/3?key=v1.public.SECRET&foo=1 failed')).toBe(
      'GET https://x/tiles/1/2/3?key=<redacted>&foo=1 failed',
    );
  });
});

describe('staticMapUrl', () => {
  it('builds a Maps v2 GetStaticMap URL with lng,lat center and a pin; null without a key', async () => {
    const { staticMapUrl } = await import('./mapStyle');
    const u = new URL(
      staticMapUrl(
        { region: 'us-east-2', mapApiKey: 'k' },
        { lat: 42.39, lng: -72.52 },
        {
          width: 600,
          height: 280,
          scheme: 'Dark',
        },
      )!,
    );
    expect(u.origin + u.pathname).toBe('https://maps.geo.us-east-2.amazonaws.com/v2/static/map@2x');
    expect(u.searchParams.get('center')).toBe('-72.52,42.39');
    expect(u.searchParams.get('color-scheme')).toBe('Dark');
    expect(u.searchParams.get('compact-overlay')).toMatch(/^point:-72.52,42.39;/);
    expect(
      staticMapUrl({ region: 'us-east-2' }, { lat: 1, lng: 2 }, { width: 1, height: 1 }),
    ).toBeNull();
  });
});
