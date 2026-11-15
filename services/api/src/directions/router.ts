/**
 * Walking directions ("Get me there"). Amazon Location Routes API v2 — CalculateRoutes with
 * TravelMode=Pedestrian, simple GeoJSON-style geometry and step instructions. Pedestrian routing
 * has no step-free / accessibility option (TravelModeOptions.Pedestrian only takes Speed;
 * AccessibilityAttributes exist for Transit/Intermodal only), so `accessibleRouting` is reported
 * honestly as false and we route to the building's accessible entrance instead.
 *
 * Privacy: callers pass coordinates already rounded to ~10 m; nothing here logs or stores them.
 */
import { CalculateRoutesCommand, GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import type { LatLng, RouteStep } from '@freeroom/shared';

export interface WalkLeg {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: [number, number][];
  steps: RouteStep[];
}

export interface Router {
  readonly accessibleRouting: boolean;
  walk(origin: LatLng, destination: LatLng): Promise<WalkLeg>;
}

/** 4 decimal places ≈ 11 m of latitude: enough to route, too coarse to pinpoint a person. */
export const roundCoord = (x: number) => Math.round(x * 1e4) / 1e4;
export const roundLatLng = (p: LatLng): LatLng => ({
  lat: roundCoord(p.lat),
  lng: roundCoord(p.lng),
});

interface RawStep {
  Distance?: number;
  Duration?: number;
  Type?: string;
  Instruction?: string;
  TurnStepDetails?: { SteeringDirection?: string };
  KeepStepDetails?: { SteeringDirection?: string };
}

const direction = (s: RawStep): RouteStep['direction'] => {
  const d = (s.TurnStepDetails ?? s.KeepStepDetails)?.SteeringDirection?.toLowerCase();
  return d === 'left' || d === 'right' || d === 'straight' ? d : undefined;
};

export function awsRouter(client = new GeoRoutesClient({})): Router {
  return {
    accessibleRouting: false,
    async walk(origin, destination) {
      const r = await client.send(
        new CalculateRoutesCommand({
          Origin: [origin.lng, origin.lat],
          Destination: [destination.lng, destination.lat],
          TravelMode: 'Pedestrian',
          LegGeometryFormat: 'Simple',
          LegAdditionalFeatures: ['TravelStepInstructions', 'Summary'],
          TravelStepType: 'Default',
          InstructionsMeasurementSystem: 'Imperial',
          Languages: ['en-US'],
        }),
      );
      const route = r.Routes?.[0];
      if (!route?.Legs?.length) throw new Error('no route');
      const coordinates: [number, number][] = [];
      const steps: RouteStep[] = [];
      let distanceMeters = 0;
      let durationSeconds = 0;
      for (const leg of route.Legs) {
        for (const p of leg.Geometry?.LineString ?? []) coordinates.push([p[0]!, p[1]!]);
        const ped = leg.PedestrianLegDetails;
        distanceMeters += ped?.Summary?.Overview?.Distance ?? 0;
        durationSeconds += ped?.Summary?.Overview?.Duration ?? 0;
        for (const s of (ped?.TravelSteps ?? []) as RawStep[]) {
          const dir = direction(s);
          steps.push({
            instruction: s.Instruction ?? s.Type ?? 'Continue',
            distanceMeters: s.Distance ?? 0,
            durationSeconds: s.Duration ?? 0,
            type: s.Type ?? 'Continue',
            ...(dir && { direction: dir }),
          });
        }
      }
      if (!distanceMeters) distanceMeters = steps.reduce((a, s) => a + s.distanceMeters, 0);
      if (!durationSeconds) durationSeconds = steps.reduce((a, s) => a + s.durationSeconds, 0);
      return { distanceMeters, durationSeconds, coordinates, steps };
    },
  };
}

/** Haversine distance in metres. */
export function metersBetween(a: LatLng, b: LatLng) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Local / mock mode (no AWS): an honest dog-leg walk at 1.3 m/s, so the map, ETA and verdict all
 * work on a laptop. Never used in a deployed stage.
 */
export function straightLineRouter(): Router {
  return {
    accessibleRouting: false,
    async walk(origin, destination) {
      const corner = { lat: origin.lat, lng: destination.lng };
      const d1 = metersBetween(origin, corner);
      const d2 = metersBetween(corner, destination);
      const sec = (m: number) => Math.round(m / 1.3);
      const eastWest = destination.lng > origin.lng ? 'east' : 'west';
      const northSouth = destination.lat > origin.lat ? 'north' : 'south';
      return {
        distanceMeters: Math.round(d1 + d2),
        durationSeconds: sec(d1 + d2),
        coordinates: [
          [origin.lng, origin.lat],
          [corner.lng, corner.lat],
          [destination.lng, destination.lat],
        ],
        steps: [
          {
            instruction: `Head ${eastWest} across campus`,
            distanceMeters: Math.round(d1),
            durationSeconds: sec(d1),
            type: 'Depart',
          },
          {
            instruction: `Turn ${northSouth} toward the entrance`,
            distanceMeters: Math.round(d2),
            durationSeconds: sec(d2),
            type: 'Turn',
            direction: northSouth === 'north' ? 'left' : 'right',
          },
          {
            instruction: 'Arrive at the entrance',
            distanceMeters: 0,
            durationSeconds: 0,
            type: 'Arrive',
          },
        ],
      };
    },
  };
}

/** Per-container cache keyed by (rounded origin, room, accessible). 2 minutes, bounded. */
export class RouteCache {
  private readonly map = new Map<string, { at: number; leg: WalkLeg }>();
  constructor(
    private readonly ttlMs = 120_000,
    private readonly max = 500,
  ) {}
  get(key: string, now: number) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (now - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.leg;
  }
  set(key: string, leg: WalkLeg, now: number) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { at: now, leg });
  }
}
