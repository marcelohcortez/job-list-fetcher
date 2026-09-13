import { useCallback, useEffect, useState } from 'react';
import {
  fetchJobs,
  setJobMark,
  triggerIngestion,
  type IngestionRun,
  type JobMark,
  type JobOpening,
} from './api';
import { JobCard } from './components/JobCard';
import { CvTab } from './CvTab';

type Tab = 'jobs' | 'cv';

interface Summary {
  counts: IngestionRun['counts'];
  ranAt: Date;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('jobs');
  const [jobs, setJobs] = useState<JobOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Record<string, boolean>>({});

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

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const run = await triggerIngestion();
      setSummary({ counts: run.counts, ranAt: new Date() });
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

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <div>
            <h1>Job List Fetcher</h1>
            <p className="subtitle">
              Curated IT, Business, Data and Cybersecurity roles in Gothenburg
              and across Europe/EMEA.
            </p>
          </div>
          <button
            className="refresh"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh jobs'}
          </button>
        </div>
        <nav className="tabs" aria-label="Sections">
          <button
            className={tab === 'jobs' ? 'tab active' : 'tab'}
            onClick={() => setTab('jobs')}
          >
            All jobs
          </button>
          <button
            className={tab === 'cv' ? 'tab active' : 'tab'}
            onClick={() => setTab('cv')}
          >
            CV matches
          </button>
        </nav>
        {tab === 'jobs' && (
          <div className="header-bottom">
            <input
              type="search"
              value={query}
              placeholder="Search title, company or description"
              onChange={(e) => handleSearch(e.target.value)}
              aria-label="Search jobs"
            />
            <span className="count">
              {jobs.length} job{jobs.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {summary && (
          <p className="summary">
            Last refresh: {summary.ranAt.toLocaleTimeString()} — fetched{' '}
            {summary.counts.fetched}, accepted {summary.counts.accepted}, new{' '}
            {summary.counts.created}, updated {summary.counts.updated}, already
            known {summary.counts.deduplicated}
          </p>
        )}
      </header>

      {error && tab === 'jobs' && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <main>
        {tab === 'cv' ? (
          <CvTab />
        ) : loading ? (
          <p className="muted">Loading jobs...</p>
        ) : jobs.length === 0 ? (
          <p className="muted">
            No jobs found. Click &quot;Refresh jobs&quot; to fetch the latest
            listings.
          </p>
        ) : (
          <ul className="jobs">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                markDisabled={pendingMarks[job.id]}
                onMark={handleMark}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
