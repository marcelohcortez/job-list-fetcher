const LOCATION_SYNONYMS: Record<string, string> = {
  goteborg: 'gothenburg',
  gothenburg: 'gothenburg',
  gotheborg: 'gothenburg',
  gotheburg: 'gothenburg',
};

export function normalizeLocation(location: string): string {
  if (!location) return '';
  return location
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function canonicalizeLocation(location: string): string {
  if (!location) return '';
  const stripped = normalizeLocation(location).replace(/\s+/g, '');
  return LOCATION_SYNONYMS[stripped] ?? stripped;
}

export function matchLocations(location1: string, location2: string): boolean {
  if (!location1 && !location2) return true;
  if (!location1 || !location2) return false;
  return canonicalizeLocation(location1) === canonicalizeLocation(location2);
}
