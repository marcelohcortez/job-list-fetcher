import { STOPWORDS } from './stopwords';

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[-–—/.,:;(){}_+*#@&%$=<>|"'\u2018\u2019\u201c\u201d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function termFrequencies(text: string): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokenize(text)) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return frequencies;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsPhrase(normalized: string, phrase: string): boolean {
  const pattern = `\\b${escapeRegExp(normalizeText(phrase).trim())}\\b`;
  return new RegExp(pattern, 'i').test(normalized);
}
