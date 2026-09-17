import { useCallback, useEffect, useState } from 'react';
import {
  fetchAllMatches,
  setJobMark,
  type CandidateMatches,
  type JobMark,
  type JobOpening,
} from './api';
import { JobCard } from './components/JobCard';

export function MatchesTab() {
  const [candidateMatches, setCandidateMatches] = useState<CandidateMatches[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Record<string, boolean>>({});

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

  if (loading) return <p className="muted">Loading matches...</p>;

  return (
    <section className="matches-tab">
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
        candidateMatches.map((entry) => (
          <details key={entry.candidateId} className="candidate-matches">
            <summary>
              <h2>{entry.candidateName ?? entry.fileName}</h2>
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
                    skillCoverage={job.skillCoverage}
                    matchedSkillCount={job.matchedSkillCount}
                    requiredSkillCount={job.requiredSkillCount}
                    matchedSkills={job.matchedSkills}
                    missingSkills={job.missingSkills}
                    markDisabled={pendingMarks[job.id]}
                    onMark={handleMark}
                  />
                ))}
              </ul>
            )}
          </details>
        ))
      )}
    </section>
  );
}
