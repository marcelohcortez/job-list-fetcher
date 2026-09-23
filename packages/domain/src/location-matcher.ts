export const DEFAULT_LOCATION_SYNONYMS: Readonly<Record<string, string>> = {
  goteborg: 'gothenburg',
  gothenburg: 'gothenburg',
  gotheborg: 'gothenburg',
  gotheburg: 'gothenburg',
};

let locationSynonyms: Record<string, string> = { ...DEFAULT_LOCATION_SYNONYMS };

export function getLocationSynonyms(): Readonly<Record<string, string>> {
  return locationSynonyms;
}

/** Overrides the location-spelling synonym map (e.g. loaded from the Configuration screen). */
export function setLocationSynonyms(map: Readonly<Record<string, string>>): void {
  locationSynonyms = { ...map };
}

export function normalizeLocation(location: string): string {
  if (!location) return '';
  return location
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function canonicalizeLocation(location: string): string {
  if (!location) return '';
  const stripped = normalizeLocation(location).replace(/\s+/g, '');
  return locationSynonyms[stripped] ?? stripped;
}

export function matchLocations(location1: string, location2: string): boolean {
  if (!location1 && !location2) return true;
  if (!location1 || !location2) return false;
  return canonicalizeLocation(location1) === canonicalizeLocation(location2);
}
