import { normalizeLocation } from './location-matcher';
import { TARGET_ROLES } from './target-roles';

function normalizeTitle(value: string): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-–—/_&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonicalizes common compound spellings so that e.g. "Full-Stack",
 * "Full Stack" and "Fullstack" all match, as do "Frontend", "Front-End"
 * and "Front End".
 */
function canonicalizeCompounds(value: string): string {
  return value
    .replace(/full stack/g, 'fullstack')
    .replace(/front end/g, 'frontend')
    .replace(/e commerce/g, 'ecommerce');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generic job-title suffix words. When a target role ends with one of these,
 * the suffix is made optional in its pattern, so e.g. "Customer Enablement
 * Specialist" also matches a listing titled just "Customer Enablement".
 * Only applied when the remaining phrase still has 2+ words, so roles like
 * "Technical Lead" (which would degrade to the overly generic "Technical")
 * keep requiring the full phrase.
 */
const GENERIC_TITLE_SUFFIXES = new Set([
  'specialist',
  'manager',
  'lead',
  'engineer',
  'developer',
  'architect',
  'consultant',
  'analyst',
]);

const TARGET_TITLE_PATTERNS: readonly RegExp[] = TARGET_ROLES.map((role) => {
  const phrase = canonicalizeCompounds(normalizeTitle(role));
  const words = phrase.split(' ');
  const lastWord = words[words.length - 1];
  if (words.length > 2 && GENERIC_TITLE_SUFFIXES.has(lastWord)) {
    const corePhrase = words.slice(0, -1).join(' ');
    const otherSuffixes = [...GENERIC_TITLE_SUFFIXES]
      .filter((suffix) => suffix !== lastWord)
      .map(escapeRegExp)
      .join('|');
    // Core phrase followed by nothing, or by its own suffix - but not by a
    // *different* generic suffix, which would mean a different role
    // (e.g. "Customer Success Specialist" must not match "Customer Success
    // Engineer"'s pattern just because "Customer Success" is a substring).
    return new RegExp(
      `\\b${escapeRegExp(corePhrase)}\\b(?!\\s+(?:${otherSuffixes})\\b)(?:\\s+${escapeRegExp(lastWord)}\\b)?`,
      'i',
    );
  }
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i');
});

/**
 * Whether a listing title matches one of the platform's target roles.
 * Matches whole role phrases at word boundaries so that e.g. "Software
 * Engineer" does not match "Software Engineering Manager".
 */
export function matchesTargetTitle(title: string): boolean {
  const normalized = canonicalizeCompounds(normalizeTitle(title));
  if (!normalized) return false;
  return TARGET_TITLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Accepted locations: Gothenburg/Göteborg, and Europe/EMEA-wide postings
 * (e.g. "Global Europe", "Global EMEA"). Pure "Remote" and remote roles tied
 * to Europe are accepted; remote roles tied to an explicitly non-European
 * country or region (US, Canada, APAC, …) are rejected.
 */
export function matchesTargetLocation(location: string): boolean {
  const normalized = normalizeLocation(location).replace(/\./g, '');
  if (!normalized) return false;
  if (/\b(gothenburg|goteborg|gbg)\b/i.test(normalized)) return true;
  const hasRemote = /\bremote\b/.test(normalized);
  const hasEurope = /\b(europe|emea|europa|european|eu)\b/i.test(normalized);
  if (!hasRemote && !hasEurope) return false;
  if (hasRemote && NON_EMEA_LOCATION_RE.test(normalized)) return false;
  return true;
}

const NON_EMEA_LOCATION_RE =
  /\b(us|usa|united states|americas?\b|canada|mexico|brazil|argentina|chile|colombia|peru|uruguay|venezuela|latam|latin america|apac|asia|india|japan|china|singapore|indonesia|philippines|australia|new zealand|anz|africa|mena|dubai|mid[ -]?east|south africa|israel|tel aviv|saarc|bangalore|bangaluru|chennai|mumbai|new delhi|sydney|melbourne|sao paulo)\b|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|west virginia|wisconsin|wyoming|ontario|quebec|alberta|manitoba|saskatchewan|toronto|vancouver|ottawa|montreal|calgary|dallas|houston|austin|seattle|chicago|boston|san francisco|los angeles|santa monica|philadelphia|raleigh|princeton|madison|columbus|kansas city|miami|atlanta|denver|portland|boulder|salt lake|las vegas|palo alto|mountain view|anchor[a-z]*|honolulu|district of columbia|\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b/i;

export function isJobInScope(title: string, location: string): boolean {
  return matchesTargetTitle(title) && matchesTargetLocation(location);
}
