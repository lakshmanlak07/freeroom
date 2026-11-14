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
