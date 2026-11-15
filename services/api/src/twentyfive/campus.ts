/**
 * Building geodata seed (PRD §13.4: 25Live has no reliable coordinates, so buildings come
 * from this hand-curated list for both the mock and the real source).
 */
export interface SourceBuilding {
  buildingId: string;
  name: string;
  lat: number;
  lng: number;
}

export const CAMPUS_BUILDINGS: readonly SourceBuilding[] = [
  { buildingId: 'LGRT', name: 'Lederle Graduate Research Tower', lat: 42.394, lng: -72.5265 },
  { buildingId: 'ILC', name: 'Integrative Learning Center', lat: 42.3911, lng: -72.5262 },
  { buildingId: 'CS', name: 'Computer Science Building', lat: 42.3951, lng: -72.531 },
  { buildingId: 'DUBOIS', name: 'W.E.B. Du Bois Library', lat: 42.3896, lng: -72.5283 },
  { buildingId: 'GOESS', name: 'Goessmann Laboratory', lat: 42.394, lng: -72.5282 },
  { buildingId: 'HAS', name: 'Hasbrouck Laboratory', lat: 42.3922, lng: -72.5262 },
  { buildingId: 'ISEN', name: 'Isenberg School of Management', lat: 42.387, lng: -72.5245 },
  { buildingId: 'TOBIN', name: 'Tobin Hall', lat: 42.3888, lng: -72.5291 },
  { buildingId: 'MORRILL', name: 'Morrill Science Center', lat: 42.3909, lng: -72.5243 },
  { buildingId: 'MARCUS', name: 'Marcus Hall', lat: 42.3934, lng: -72.5295 },
];

export interface Entrance {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Hand-curated door positions (approximate, for walking directions): the main entrance and the
 * step-free / accessible entrance of every seeded building. Kept apart from the catalog so the
 * stored building items don't change.
 */
export const ENTRANCES: Readonly<Record<string, { main: Entrance; accessible: Entrance }>> = {
  LGRT: {
    main: { lat: 42.39385, lng: -72.52685, label: 'LGRT lobby (west doors)' },
    accessible: { lat: 42.39418, lng: -72.52622, label: 'LGRT east ramp entrance' },
  },
  ILC: {
    main: { lat: 42.39092, lng: -72.52655, label: 'ILC main entrance (south plaza)' },
    accessible: {
      lat: 42.39131,
      lng: -72.52598,
      label: 'ILC north entrance (level, automatic doors)',
    },
  },
  CS: {
    main: { lat: 42.39492, lng: -72.53082, label: 'CS Building front doors' },
    accessible: { lat: 42.39531, lng: -72.53131, label: 'CS Building ramp (Governors Dr side)' },
  },
  DUBOIS: {
    main: { lat: 42.38938, lng: -72.52798, label: 'Du Bois Library main entrance' },
    accessible: {
      lat: 42.38925,
      lng: -72.52851,
      label: 'Du Bois Library accessible entrance (west)',
    },
  },
  GOESS: {
    main: { lat: 42.39381, lng: -72.52838, label: 'Goessmann main entrance' },
    accessible: { lat: 42.39421, lng: -72.52801, label: 'Goessmann accessible entrance (north)' },
  },
  HAS: {
    main: { lat: 42.39203, lng: -72.52641, label: 'Hasbrouck main entrance' },
    accessible: { lat: 42.39238, lng: -72.52601, label: 'Hasbrouck accessible entrance (east)' },
  },
  ISEN: {
    main: { lat: 42.38718, lng: -72.52472, label: 'Isenberg main atrium entrance' },
    accessible: {
      lat: 42.38689,
      lng: -72.52421,
      label: 'Isenberg Business Innovation Hub entrance',
    },
  },
  TOBIN: {
    main: { lat: 42.38862, lng: -72.52889, label: 'Tobin Hall main entrance' },
    accessible: { lat: 42.38901, lng: -72.52931, label: 'Tobin Hall accessible entrance (north)' },
  },
  MORRILL: {
    main: { lat: 42.39071, lng: -72.52452, label: 'Morrill main entrance' },
    accessible: { lat: 42.39112, lng: -72.52401, label: 'Morrill accessible entrance (east)' },
  },
  MARCUS: {
    main: { lat: 42.39321, lng: -72.52968, label: 'Marcus Hall main entrance' },
    accessible: { lat: 42.39359, lng: -72.52921, label: 'Marcus Hall accessible entrance' },
  },
};
