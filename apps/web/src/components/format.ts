export function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function snippet(text: string | null, max = 240): string | null {
  if (!text) return null;
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}...`;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

interface SearchableJob {
  title: string;
  companyName: string;
  description: string | null;
  sentCvIds: string[];
}

interface SearchableCandidate {
  id: string;
  candidateName: string | null;
}

export function matchesJobSearch(
  job: SearchableJob,
  term: string,
  candidates: SearchableCandidate[],
): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;

  if (job.title.toLowerCase().includes(needle)) return true;
  if (job.companyName.toLowerCase().includes(needle)) return true;
  if (job.description?.toLowerCase().includes(needle)) return true;

  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  return job.sentCvIds.some((id) =>
    candidateById.get(id)?.candidateName?.toLowerCase().includes(needle),
  );
}
