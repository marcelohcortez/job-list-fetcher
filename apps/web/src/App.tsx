import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import BookmarkBorderOutlinedIcon from '@mui/icons-material/BookmarkBorderOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import TrackChangesOutlinedIcon from '@mui/icons-material/TrackChangesOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import {
  buildTopMatchesByJobId,
  fetchAllMatches,
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
import { matchesJobSearch, sortByPublishedDesc } from './components/format';
import { UploadCvTab } from './UploadCvTab';
import { UploadCvsTab } from './UploadCvsTab';
import { MatchesTab } from './MatchesTab';
import { ConfigTab } from './ConfigTab';
import { MARK_TOAST_MESSAGE, SuccessToast, useSuccessToast } from './components/Toast';

type Tab =
  'jobs' | 'applied' | 'saved' | 'history' | 'upload-cv' | 'upload-cvs' | 'matches' | 'config';

interface Summary {
  counts: IngestionRun['counts'];
  warnings: string[];
  ranAt: Date;
}

const NAV_ITEMS: {
  id: Tab;
  path: string;
  label: string;
  Icon: typeof WorkOutlineOutlinedIcon;
}[] = [
  { id: 'matches', path: '/matches', label: 'Matches', Icon: TrackChangesOutlinedIcon },
  { id: 'applied', path: '/applied', label: 'Applied', Icon: TaskAltOutlinedIcon },
  { id: 'saved', path: '/saved', label: 'Saved', Icon: BookmarkBorderOutlinedIcon },
  { id: 'jobs', path: '/jobs', label: 'Openings', Icon: WorkOutlineOutlinedIcon },
  { id: 'history', path: '/history', label: 'History', Icon: HistoryOutlinedIcon },
  { id: 'upload-cv', path: '/upload-cv', label: 'Upload CV', Icon: UploadFileOutlinedIcon },
  { id: 'upload-cvs', path: '/upload-cvs', label: 'Upload CVs', Icon: LibraryBooksOutlinedIcon },
  { id: 'config', path: '/config', label: 'Configuration', Icon: SettingsOutlinedIcon },
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
  saved: {
    title: 'Saved',
    subtitle: 'Job openings you have marked as interested.',
  },
  history: {
    title: 'History',
    subtitle: 'Job openings you have marked as seen or dead.',
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
  config: {
    title: 'Configuration',
    subtitle: 'Edit the titles, suffixes and regex patterns used to filter and match jobs.',
  },
};

const ALL_SOURCES = 'all';

function JobsTab({
  jobs,
  knownSources,
  loading,
  error,
  pendingMarks,
  onMark,
  pendingSeen,
  onToggleSeen,
  candidates,
  pendingSentCvs,
  onChangeSentCvs,
  topMatchesByJobId,
}: {
  jobs: JobOpening[];
  knownSources: string[];
  loading: boolean;
  error: string | null;
  pendingMarks: Record<string, boolean>;
  onMark: (job: JobOpening, mark: JobMark) => void;
  pendingSeen: Record<string, boolean>;
  onToggleSeen: (job: JobOpening) => void;
  candidates: Candidate[];
  pendingSentCvs: Record<string, boolean>;
  onChangeSentCvs: (job: JobOpening, candidateIds: string[]) => void;
  topMatchesByJobId: Record<string, string[]>;
}) {
  const [activeSource, setActiveSource] = useState<string>(ALL_SOURCES);
  const [search, setSearch] = useState('');

  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const activeJobs = jobs.filter(
    (job) =>
      job.userMark !== 'dead' &&
      job.userMark !== 'applied' &&
      !job.seenAt &&
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

  const sourceJobs =
    activeSource === ALL_SOURCES
      ? activeJobs
      : activeJobs.filter((job) => job.sourceName === activeSource);
  const visibleJobs = sortByPublishedDesc(
    sourceJobs.filter((job) => matchesJobSearch(job, search, candidates)),
  );

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          value={search}
          placeholder="Search title, company, description or employee"
          onChange={(e) => setSearch(e.target.value)}
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
            className={activeSource === ALL_SOURCES ? 'source-tab active' : 'source-tab'}
            onClick={() => setActiveSource(ALL_SOURCES)}
          >
            All ({activeJobs.length})
          </button>
          {sources.map((source) => {
            const count = activeJobs.filter((job) => job.sourceName === source).length;
            return (
              <button
                key={source}
                role="tab"
                aria-selected={activeSource === source}
                className={activeSource === source ? 'source-tab active' : 'source-tab'}
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
          No jobs found. Click &quot;Refresh jobs&quot; to fetch the latest listings.
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
              topMatchNames={topMatchesByJobId[job.id]}
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
  topMatchesByJobId,
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
  topMatchesByJobId: Record<string, string[]>;
}) {
  const [search, setSearch] = useState('');
  const appliedJobs = sortByPublishedDesc(
    jobs
      .filter((job) => job.userMark === 'applied')
      .filter((job) => matchesJobSearch(job, search, candidates)),
  );

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          value={search}
          placeholder="Search title, company, description or employee"
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search applied jobs"
        />
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
          No applications yet. Mark a job as &quot;Applied&quot; from the Openings tab.
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
              topMatchNames={topMatchesByJobId[job.id]}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function SavedTab({
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
  topMatchesByJobId,
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
  topMatchesByJobId: Record<string, string[]>;
}) {
  const [search, setSearch] = useState('');
  const savedJobs = sortByPublishedDesc(
    jobs
      .filter((job) => job.userMark === 'saved')
      .filter((job) => matchesJobSearch(job, search, candidates)),
  );

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          value={search}
          placeholder="Search title, company, description or employee"
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search saved jobs"
        />
        <span className="count">
          {savedJobs.length} job{savedJobs.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading jobs...</p>
      ) : savedJobs.length === 0 ? (
        <p className="muted">
          No saved openings yet. Click &quot;Save&quot; on an Opening from the Openings or Matches
          tab.
        </p>
      ) : (
        <ul className="jobs">
          {savedJobs.map((job) => (
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
              topMatchNames={topMatchesByJobId[job.id]}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function HistoryTab({
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
  topMatchesByJobId,
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
  topMatchesByJobId: Record<string, string[]>;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'seen' | 'dead'>('all');
  const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const historyJobs = jobs
    .filter(
      (job) =>
        job.userMark === 'dead' || (job.seenAt && new Date(job.seenAt).getTime() >= threeMonthsAgo),
    )
    .filter((job) => matchesJobSearch(job, search, candidates));

  const seenCount = historyJobs.filter((job) => job.userMark !== 'dead' && job.seenAt).length;
  const deadCount = historyJobs.filter((job) => job.userMark === 'dead').length;

  const filteredHistoryJobs = sortByPublishedDesc(
    historyJobs.filter((job) => {
      if (statusFilter === 'seen') return job.userMark !== 'dead' && job.seenAt;
      if (statusFilter === 'dead') return job.userMark === 'dead';
      return true;
    }),
  );

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          value={search}
          placeholder="Search title, company, description or employee"
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search history"
        />
        <span className="count">
          {filteredHistoryJobs.length} job
          {filteredHistoryJobs.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="source-tabs" role="tablist" aria-label="History status">
        <button
          role="tab"
          aria-selected={statusFilter === 'all'}
          className={statusFilter === 'all' ? 'source-tab active' : 'source-tab'}
          onClick={() => setStatusFilter('all')}
        >
          All ({historyJobs.length})
        </button>
        <button
          role="tab"
          aria-selected={statusFilter === 'seen'}
          className={statusFilter === 'seen' ? 'source-tab active' : 'source-tab'}
          onClick={() => setStatusFilter('seen')}
        >
          Seen ({seenCount})
        </button>
        <button
          role="tab"
          aria-selected={statusFilter === 'dead'}
          className={statusFilter === 'dead' ? 'source-tab active' : 'source-tab'}
          onClick={() => setStatusFilter('dead')}
        >
          Dead ({deadCount})
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading jobs...</p>
      ) : filteredHistoryJobs.length === 0 ? (
        <p className="muted">
          {historyJobs.length === 0
            ? 'No history yet. Mark an opening "Seen" or "Dead" to move it here.'
            : 'No jobs match this filter.'}
        </p>
      ) : (
        <ul className="jobs">
          {filteredHistoryJobs.map((job) => (
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
              topMatchNames={topMatchesByJobId[job.id]}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export default function App() {
  const location = useLocation();
  const currentTab = NAV_ITEMS.find((item) => location.pathname === item.path)?.id ?? 'jobs';

  const [jobs, setJobs] = useState<JobOpening[]>([]);
  const [knownSources, setKnownSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Record<string, boolean>>({});
  const [pendingSeen, setPendingSeen] = useState<Record<string, boolean>>({});
  const { toast, showToast } = useSuccessToast();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pendingSentCvs, setPendingSentCvs] = useState<Record<string, boolean>>({});
  const [topMatchesByJobId, setTopMatchesByJobId] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJobs();
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

  useEffect(() => {
    fetchAllMatches()
      .then((matches) => setTopMatchesByJobId(buildTopMatchesByJobId(matches)))
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
        await load();
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
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleMark = async (job: JobOpening, mark: JobMark) => {
    if (pendingMarks[job.id]) return;
    const current = job.userMark;
    const next = current === mark ? null : mark;

    setPendingMarks((prev) => ({ ...prev, [job.id]: true }));
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, userMark: next } : j)));
    try {
      const saved = await setJobMark(job.id, next);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, userMark: saved } : j)));
      if (saved) showToast(MARK_TOAST_MESSAGE[saved]);
    } catch (err) {
      setError((err as Error).message);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, userMark: current } : j)));
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
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, seenAt: next } : j)));
    try {
      const saved = await setJobSeen(job.id, !current);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, seenAt: saved } : j)));
      if (saved) showToast('marked as seen');
    } catch (err) {
      setError((err as Error).message);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, seenAt: current } : j)));
    } finally {
      setPendingSeen((prev) => {
        const { [job.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleMatchesMarkChange = (jobId: string, mark: JobMark | null) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, userMark: mark } : j)));
  };

  const handleChangeSentCvs = async (job: JobOpening, candidateIds: string[]) => {
    if (pendingSentCvs[job.id]) return;
    const current = job.sentCvIds;
    const currentMark = job.userMark;
    const shouldMarkApplied =
      current.length === 0 && candidateIds.length > 0 && currentMark !== 'applied';

    setPendingSentCvs((prev) => ({ ...prev, [job.id]: true }));
    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id
          ? { ...j, sentCvIds: candidateIds, userMark: shouldMarkApplied ? 'applied' : j.userMark }
          : j,
      ),
    );
    try {
      const saved = await setJobSentCvs(job.id, candidateIds);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, sentCvIds: saved } : j)));
      if (shouldMarkApplied) {
        const savedMark = await setJobMark(job.id, 'applied');
        setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, userMark: savedMark } : j)));
      }
    } catch (err) {
      setError((err as Error).message);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, sentCvIds: current, userMark: currentMark } : j,
        ),
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
      <SuccessToast message={toast} />
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
              className={currentTab === item.id ? 'sidenav-item active' : 'sidenav-item'}
            >
              <item.Icon className="sidenav-icon" fontSize="small" aria-hidden="true" />
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
            Last refresh: {summary.ranAt.toLocaleTimeString()} — fetched {summary.counts.fetched},
            accepted {summary.counts.accepted}, new {summary.counts.created}, updated{' '}
            {summary.counts.updated}, already known {summary.counts.deduplicated}
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
                  pendingMarks={pendingMarks}
                  onMark={handleMark}
                  pendingSeen={pendingSeen}
                  onToggleSeen={handleToggleSeen}
                  candidates={candidates}
                  pendingSentCvs={pendingSentCvs}
                  onChangeSentCvs={handleChangeSentCvs}
                  topMatchesByJobId={topMatchesByJobId}
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
                  topMatchesByJobId={topMatchesByJobId}
                />
              }
            />
            <Route
              path="/saved"
              element={
                <SavedTab
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
                  topMatchesByJobId={topMatchesByJobId}
                />
              }
            />
            <Route
              path="/history"
              element={
                <HistoryTab
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
                  topMatchesByJobId={topMatchesByJobId}
                />
              }
            />
            <Route path="/upload-cv" element={<UploadCvTab />} />
            <Route path="/upload-cvs" element={<UploadCvsTab />} />
            <Route
              path="/matches"
              element={<MatchesTab onMarkChange={handleMatchesMarkChange} />}
            />
            <Route path="/config" element={<ConfigTab />} />
            <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
