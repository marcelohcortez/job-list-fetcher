import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAllMatches,
  setJobMark,
  setJobSeen,
  type CandidateMatches,
  type JobMark,
  type JobOpening,
} from './api';
import { JobCard } from './components/JobCard';
import { MARK_TOAST_MESSAGE, SuccessToast, useSuccessToast } from './components/Toast';
import { sortByPublishedDesc } from './components/format';

interface MatchesTabProps {
  onMarkChange?: (jobId: string, mark: JobMark | null) => void;
}

function candidateLabel(entry: CandidateMatches): string {
  return entry.candidateName ?? entry.fileName;
}

export function MatchesTab({ onMarkChange }: MatchesTabProps) {
  const [candidateMatches, setCandidateMatches] = useState<CandidateMatches[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Record<string, boolean>>({});
  const [pendingSeen, setPendingSeen] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const { toast, showToast } = useSuccessToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCandidateMatches(await fetchAllMatches());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMark = async (job: JobOpening, mark: JobMark) => {
    if (pendingMarks[job.id]) return;
    const current = job.userMark;
    const next = current === mark ? null : mark;

    const applyMark = (value: JobMark | null) =>
      setCandidateMatches((prev) =>
        prev.map((entry) => ({
          ...entry,
          matches: entry.matches.map((m) =>
            m.id === job.id ? { ...m, userMark: value } : m,
          ),
        })),
      );

    setPendingMarks((prev) => ({ ...prev, [job.id]: true }));
    applyMark(next);
    try {
      const saved = await setJobMark(job.id, next);
      applyMark(saved);
      onMarkChange?.(job.id, saved);
      if (saved) showToast(MARK_TOAST_MESSAGE[saved]);
    } catch (err) {
      setError((err as Error).message);
      applyMark(current);
    } finally {
      setPendingMarks((prev) => {
        const { [job.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleToggleSeen = async (job: JobOpening) => {
    if (pendingSeen[job.id]) return;
    const current = job.seenAt;
    const next = !current;

    const applySeen = (value: string | null) =>
      setCandidateMatches((prev) =>
        prev.map((entry) => ({
          ...entry,
          matches: entry.matches.map((m) =>
            m.id === job.id ? { ...m, seenAt: value } : m,
          ),
        })),
      );

    setPendingSeen((prev) => ({ ...prev, [job.id]: true }));
    applySeen(next ? new Date().toISOString() : null);
    try {
      const saved = await setJobSeen(job.id, next);
      applySeen(saved);
      if (saved) showToast('marked as seen');
    } catch (err) {
      setError((err as Error).message);
      applySeen(current);
    } finally {
      setPendingSeen((prev) => {
        const { [job.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const sortedMatches = useMemo(
    () =>
      [...candidateMatches]
        .map((entry) => ({
          ...entry,
          matches: sortByPublishedDesc(
            entry.matches.filter((job) => job.userMark !== 'dead'),
          ),
        }))
        .sort((a, b) => candidateLabel(a).localeCompare(candidateLabel(b))),
    [candidateMatches],
  );

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return sortedMatches
      .filter((entry) => candidateLabel(entry).toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, sortedMatches]);

  const visibleMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedMatches;
    return sortedMatches.filter((entry) =>
      candidateLabel(entry).toLowerCase().includes(q),
    );
  }, [search, sortedMatches]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchBoxRef.current &&
        !searchBoxRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (loading) return <p className="muted">Loading matches...</p>;

  return (
    <section className="matches-tab">
      <SuccessToast message={toast} />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {candidateMatches.length === 0 ? (
        <p className="muted">
          No sanitized candidates yet. Upload a CV on the Upload CV or Upload
          CVs tab first.
        </p>
      ) : (
        <>
          <div className="candidate-search" ref={searchBoxRef}>
            <input
              type="text"
              className="candidate-search-input"
              placeholder="Search candidates by name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="candidate-search-suggestions">
                {suggestions.map((entry) => (
                  <li key={entry.candidateId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearch(candidateLabel(entry));
                        setShowSuggestions(false);
                      }}
                    >
                      {candidateLabel(entry)}
                      {entry.candidateTitle ? ` - ${entry.candidateTitle}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {visibleMatches.length === 0 ? (
            <p className="muted">No candidates match "{search}".</p>
          ) : (
            visibleMatches.map((entry) => (
          <details key={entry.candidateId} className="candidate-matches">
            <summary>
              <h2>
                {candidateLabel(entry)}
                {entry.candidateTitle && (
                  <span className="candidate-title"> - {entry.candidateTitle}</span>
                )}
              </h2>
              <span className="count">
                {entry.matches.length} matching opening
                {entry.matches.length === 1 ? '' : 's'}
              </span>
            </summary>
            {entry.matches.length === 0 ? (
              <p className="muted">No matching openings yet.</p>
            ) : (
              <ul className="jobs">
                {entry.matches.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    similarity={job.similarity}
                    baseScore={job.baseScore}
                    skillCoverage={job.skillCoverage}
                    matchedSkillCount={job.matchedSkillCount}
                    requiredSkillCount={job.requiredSkillCount}
                    matchedSkills={job.matchedSkills}
                    missingSkills={job.missingSkills}
                    layaScore={job.layaScore}
                    layaChoice={job.layaChoice}
                    layaReasoning={job.layaReasoning}
                    layaMismatchReasoning={job.layaMismatchReasoning}
                    layaTruncated={job.layaTruncated}
                    markDisabled={pendingMarks[job.id]}
                    onMark={handleMark}
                    seenDisabled={pendingSeen[job.id]}
                    onToggleSeen={handleToggleSeen}
                  />
                ))}
              </ul>
            )}
          </details>
            ))
          )}
        </>
      )}
    </section>
  );
}
