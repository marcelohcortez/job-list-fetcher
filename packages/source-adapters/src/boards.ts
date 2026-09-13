export interface BoardConfig {
  slug: string;
  name: string;
  host?: 'global' | 'eu';
}

export function humanizeSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function toBoardConfigs(
  boards: (string | BoardConfig)[] | undefined,
  defaults: readonly BoardConfig[],
): BoardConfig[] {
  if (!boards || boards.length === 0) return [...defaults];
  return boards.map((board) =>
    typeof board === 'string'
      ? { slug: board, name: humanizeSlug(board) }
      : { slug: board.slug, name: board.name, host: board.host },
  );
}

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export const DEFAULT_GREENHOUSE_BOARDS: readonly BoardConfig[] = [
  { slug: 'wolt', name: 'Wolt' },
  { slug: 'ubiquiti', name: 'Ubiquiti' },
  { slug: 'betsson', name: 'Betsson' },
  { slug: 'smartlyio', name: 'Smartly' },
  { slug: 'cvx', name: 'CVX Ventures' },
  { slug: 'truecaller', name: 'Truecaller' },
  { slug: 'mentimeter', name: 'Mentimeter' },
  { slug: 'energyhub', name: 'EnergyHub' },
  { slug: 'rebtel', name: 'Rebtel' },
  { slug: 'veriff', name: 'Veriff' },
  { slug: 'intellishoredk', name: 'Intellishore' },
  { slug: 'intercom', name: 'Intercom' },
  { slug: 'n26', name: 'N26' },
  { slug: 'cabify', name: 'Cabify' },
  { slug: 'algolia', name: 'Algolia' },
  { slug: 'shifttechnology', name: 'Shift Technology' },
  { slug: 'typeform', name: 'Typeform' },
  { slug: 'wallapop', name: 'Wallapop' },
  { slug: 'contentful', name: 'Contentful' },
  { slug: 'capco', name: 'Capco' },
  { slug: 'stripe', name: 'Stripe' },
  { slug: 'anthropic', name: 'Anthropic' },
  { slug: 'mongodb', name: 'MongoDB' },
  { slug: 'cloudflare', name: 'Cloudflare' },
  { slug: 'canonical', name: 'Canonical' },
  { slug: 'coinbase', name: 'Coinbase' },
  { slug: 'remotecom', name: 'Remote' },
  { slug: 'airbnb', name: 'Airbnb' },
  { slug: 'figma', name: 'Figma' },
  { slug: 'vercel', name: 'Vercel' },
  { slug: 'postman', name: 'Postman' },
  { slug: 'discord', name: 'Discord' },
  { slug: 'webflow', name: 'Webflow' },
  { slug: 'netlify', name: 'Netlify' },
];

export const DEFAULT_LEVER_BOARDS: readonly BoardConfig[] = [
  { slug: 'weloglobal', name: 'Welo' },
  { slug: 'spotify', name: 'Spotify' },
  { slug: 'burga', name: 'BURGA' },
  { slug: 'emburse', name: 'Emburse' },
  { slug: 'avalanchestudios', name: 'Avalanche Studios' },
  { slug: 'rovio-2', name: 'Rovio' },
  { slug: 'veo', name: 'Veo' },
  { slug: 'brightlyworks', name: 'Brightly Works' },
  { slug: 'uprightproject', name: 'Upright Project' },
  { slug: 'people-ai', name: 'People.ai' },
  { slug: 'veeva', name: 'Veeva Systems' },
  { slug: 'palantir', name: 'Palantir' },
  { slug: 'fresha', name: 'Fresha' },
  { slug: 'pigment', name: 'Pigment' },
  { slug: 'sophos', name: 'Sophos' },
  { slug: 'matchgroup', name: 'Match Group' },
  { slug: 'kpler', name: 'Kpler' },
  { slug: 'qonto', name: 'Qonto' },
  { slug: 'scaleway', name: 'Scaleway' },
  { slug: 'agicap', name: 'Agicap' },
  { slug: 'malt', name: 'Malt' },
  { slug: 'zocks', name: 'Zocks' },
  { slug: 'tomtom', name: 'TomTom', host: 'eu' },
  { slug: 'lever', name: 'Lever', host: 'eu' },
];
