import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  fetchCandidates,
  fetchIngestionRuns,
  fetchJobs,
  fetchSources,
  setJobMark,
  setJobSeen,
  setJobSentCvs,
  triggerIngestion,
  type Candidate,
  type IngestionRun,
  type JobMark,
  type JobOpening,
} from './api';
import { JobCard } from './components/JobCard';
import { UploadCvTab } from './UploadCvTab';
import { UploadCvsTab } from './UploadCvsTab';
import { MatchesTab } from './MatchesTab';

type Tab = 'jobs' | 'applied' | 'upload-cv' | 'upload-cvs' | 'matches';

interface Summary {
  counts: IngestionRun['counts'];
  warnings: string[];
  ranAt: Date;
}

const NAV_ITEMS: { id: Tab; path: string; label: string; icon: string }[] = [
  { id: 'jobs', path: '/jobs', label: 'Openings', icon: '💼' },
  { id: 'applied', path: '/applied', label: 'Applied', icon: '✅' },
  { id: 'upload-cv', path: '/upload-cv', label: 'Upload CV', icon: '📄' },
  { id: 'upload-cvs', path: '/upload-cvs', label: 'Upload CVs', icon: '📚' },
  { id: 'matches', path: '/matches', label: 'Matches', icon: '🎯' },
];

const TAB_TITLES: Record<Tab, { title: string; subtitle: string }> = {
  jobs: {
    title: 'Openings',
    subtitle:
      'Curated IT, Business, Data and Cybersecurity roles in Gothenburg and across Europe/EMEA.',
  },
  applied: {
    title: 'Applied',
    subtitle: 'Job openings you have already applied to.',
  },
  'upload-cv': {
    title: 'Upload CV',
    subtitle: 'Add a single candidate CV for matching.',
  },
  'upload-cvs': {
    title: 'Upload CVs',
    subtitle: 'Batch-upload candidate CVs for matching.',
  },
  matches: {
    title: 'Matches',
    subtitle: 'Candidates matched against open roles.',
  },
};

const ALL_SOURCES = 'all';

function JobsTab({
  jobs,
  knownSources,
  loading,
  error,
  query,
  onSearch,
  pendingMarks,
  onMark,
  pendingSeen,
  onToggleSeen,
  candidates,
  pendingSentCvs,
  onChangeSentCvs,
}: {
  jobs: JobOpening[];
  knownSources: string[];
  loading: boolean;
  error: string | null;
  query: string;
  onSearch: (term: string) => void;
  pendingMarks: Record<string, boolean>;
  onMark: (job: JobOpening, mark: JobMark) => void;
  pendingSeen: Record<string, boolean>;
  onToggleSeen: (job: JobOpening) => void;
  candidates: Candidate[];
  pendingSentCvs: Record<string, boolean>;
  onChangeSentCvs: (job: JobOpening, candidateIds: string[]) => void;
}) {
  const [activeSource, setActiveSource] = useState<string>(ALL_SOURCES);

  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const activeJobs = jobs.filter(
    (job) =>
      (!job.deadlineAt || new Date(job.deadlineAt).getTime() >= now) &&
      (!job.publishedAt || new Date(job.publishedAt).getTime() >= oneYearAgo),
  );

  const sources = Array.from(
    new Set([...knownSources, ...activeJobs.map((job) => job.sourceName)]),
  ).sort((a, b) => a.localeCompare(b));
  const sourcesKey = sources.join('|');

  useEffect(() => {
    if (activeSource !== ALL_SOURCES && !sources.includes(activeSource)) {
      setActiveSource(ALL_SOURCES);
    }
  }, [sourcesKey]);

  const visibleJobs =
    activeSource === ALL_SOURCES
      ? activeJobs
      : activeJobs.filter((job) => job.sourceName === activeSource);

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          value={query}
          placeholder="Search title, company or description"
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search jobs"
        />
        <span className="count">
          {visibleJobs.length} job{visibleJobs.length === 1 ? '' : 's'}
        </span>
      </div>

      {sources.length > 0 && (
        <div className="source-tabs" role="tablist" aria-label="Job sources">
          <button
            key={ALL_SOURCES}
            role="tab"
            aria-selected={activeSource === ALL_SOURCES}
            className={
              activeSource === ALL_SOURCES
                ? 'source-tab active'
                : 'source-tab'
            }
            onClick={() => setActiveSource(ALL_SOURCES)}
          >
            All ({activeJobs.length})
          </button>
          {sources.map((source) => {
            const count = activeJobs.filter(
              (job) => job.sourceName === source,
            ).length;
            return (
              <button
                key={source}
                role="tab"
                aria-selected={activeSource === source}
                className={
                  activeSource === source ? 'source-tab active' : 'source-tab'
                }
                onClick={() => setActiveSource(source)}
              >
                {source} ({count})
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading jobs...</p>
      ) : visibleJobs.length === 0 ? (
        <p className="muted">
          No jobs found. Click &quot;Refresh jobs&quot; to fetch the latest
          listings.
        </p>
      ) : (
        <ul className="jobs">
          {visibleJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              markDisabled={pendingMarks[job.id]}
              onMark={onMark}
              seenDisabled={pendingSeen[job.id]}
              onToggleSeen={onToggleSeen}
              candidates={candidates}
              sentCvsDisabled={pendingSentCvs[job.id]}
              onChangeSentCvs={onChangeSentCvs}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function AppliedTab({
  jobs,
  loading,
  error,
  pendingMarks,
  onMark,
  pendingSeen,
  onToggleSeen,
  candidates,
  pendingSentCvs,
  onChangeSentCvs,
}: {
  jobs: JobOpening[];
  loading: boolean;
  error: string | null;
  pendingMarks: Record<string, boolean>;
  onMark: (job: JobOpening, mark: JobMark) => void;
  pendingSeen: Record<string, boolean>;
  onToggleSeen: (job: JobOpening) => void;
  candidates: Candidate[];
  pendingSentCvs: Record<string, boolean>;
  onChangeSentCvs: (job: JobOpening, candidateIds: string[]) => void;
}) {
  const appliedJobs = jobs.filter((job) => job.userMark === 'applied');

  return (
    <>
      <div className="toolbar">
        <span className="count">
          {appliedJobs.length} job{appliedJobs.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading jobs...</p>
      ) : appliedJobs.length === 0 ? (
        <p className="muted">
          No applications yet. Mark a job as &quot;Applied&quot; from the
          Openings tab.
        </p>
      ) : (
        <ul className="jobs">
          {appliedJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              markDisabled={pendingMarks[job.id]}
              onMark={onMark}
              seenDisabled={pendingSeen[job.id]}
              onToggleSeen={onToggleSeen}
              candidates={candidates}
              sentCvsDisabled={pendingSentCvs[job.id]}
              onChangeSentCvs={onChangeSentCvs}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export default function App() {
  const location = useLocation();
  const currentTab =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.path))?.id ??
    'jobs';

  const [jobs, setJobs] = useState<JobOpening[]>([]);
  const [knownSources, setKnownSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Record<string, boolean>>({});
  const [pendingSeen, setPendingSeen] = useState<Record<string, boolean>>({});
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pendingSentCvs, setPendingSentCvs] = useState<Record<string, boolean>>({});

  const load = useCallback(async (term?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJobs(term || undefined);
      setJobs(res.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetchSources()
      .then(setKnownSources)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCandidates()
      .then(setCandidates)
      .catch(() => {});
  }, []);

  // A refresh triggered before a page reload keeps running server-side even
  // though the client that started it is gone - pick it back up here so the
  // button stays disabled and reload can't fire a second, overlapping run.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const runs = await fetchIngestionRuns().catch(() => []);
      const latest = runs[0];
      if (!latest || latest.status !== 'running' || cancelled) return;

      setRefreshing(true);
      while (!cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const [current] = await fetchIngestionRuns().catch(() => []);
        if (cancelled || !current || current.status === 'running') continue;
        setSummary({ counts: current.counts, warnings: [], ranAt: new Date() });
        await load(query || undefined);
        setRefreshing(false);
        break;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const run = await triggerIngestion();
      setSummary({ counts: run.counts, warnings: run.warnings, ranAt: new Date() });
      await load(query || undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSearch = (term: string) => {
    setQuery(term);
    void load(term || undefined);
  };

  const handleMark = async (job: JobOpening, mark: JobMark) => {
    if (pendingMarks[job.id]) return;
    const current = job.userMark;
    const next = current === mark ? null : mark;

    setPendingMarks((prev) => ({ ...prev, [job.id]: true }));
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, userMark: next } : j)),
    );
    try {
      const saved = await setJobMark(job.id, next);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, userMark: saved } : j)),
      );
    } catch (err) {
      setError((err as Error).message);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, userMark: current } : j)),
      );
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
    const next = current ? null : new Date().toISOString();

    setPendingSeen((prev) => ({ ...prev, [job.id]: true }));
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, seenAt: next } : j)),
    );
    try {
      const saved = await setJobSeen(job.id, !current);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, seenAt: saved } : j)),
      );
    } catch (err) {
      setError((err as Error).message);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, seenAt: current } : j)),
      );
    } finally {
      setPendingSeen((prev) => {
        const { [job.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleChangeSentCvs = async (job: JobOpening, candidateIds: string[]) => {
    if (pendingSentCvs[job.id]) return;
    const current = job.sentCvIds;

    setPendingSentCvs((prev) => ({ ...prev, [job.id]: true }));
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, sentCvIds: candidateIds } : j)),
    );
    try {
      const saved = await setJobSentCvs(job.id, candidateIds);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, sentCvIds: saved } : j)),
      );
    } catch (err) {
      setError((err as Error).message);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, sentCvIds: current } : j)),
      );
    } finally {
      setPendingSentCvs((prev) => {
        const { [job.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">JLF</span>
          <span className="brand-name">Job List Fetcher</span>
        </div>
        <nav className="sidenav" aria-label="Sections">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={
                currentTab === item.id ? 'sidenav-item active' : 'sidenav-item'
              }
            >
              <span className="sidenav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <h1>{TAB_TITLES[currentTab].title}</h1>
            <p className="subtitle">{TAB_TITLES[currentTab].subtitle}</p>
          </div>
          <button
            className="btn-primary"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh jobs'}
          </button>
        </header>

        {summary && (
          <p className="summary">
            Last refresh: {summary.ranAt.toLocaleTimeString()} — fetched{' '}
            {summary.counts.fetched}, accepted {summary.counts.accepted}, new{' '}
            {summary.counts.created}, updated {summary.counts.updated}, already
            known {summary.counts.deduplicated}
          </p>
        )}

        {summary && summary.warnings.length > 0 && (
          <div className="warning" role="alert">
            {summary.warnings.length === 1
              ? `Connector issue: ${summary.warnings[0]}`
              : 'Connector issues:'}
            {summary.warnings.length > 1 && (
              <ul>
                {summary.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/jobs" replace />} />
            <Route
              path="/jobs"
              element={
                <JobsTab
                  jobs={jobs}
                  knownSources={knownSources}
                  loading={loading}
                  error={error}
                  query={query}
                  onSearch={handleSearch}
                  pendingMarks={pendingMarks}
                  onMark={handleMark}
                  pendingSeen={pendingSeen}
                  onToggleSeen={handleToggleSeen}
                  candidates={candidates}
                  pendingSentCvs={pendingSentCvs}
                  onChangeSentCvs={handleChangeSentCvs}
                />
              }
            />
            <Route
              path="/applied"
              element={
                <AppliedTab
                  jobs={jobs}
                  loading={loading}
                  error={error}
                  pendingMarks={pendingMarks}
                  onMark={handleMark}
                  pendingSeen={pendingSeen}
                  onToggleSeen={handleToggleSeen}
                  candidates={candidates}
                  pendingSentCvs={pendingSentCvs}
                  onChangeSentCvs={handleChangeSentCvs}
                />
              }
            />
            <Route path="/upload-cv" element={<UploadCvTab />} />
            <Route path="/upload-cvs" element={<UploadCvsTab />} />
            <Route path="/matches" element={<MatchesTab />} />
            <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
