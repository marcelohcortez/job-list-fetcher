import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteCv,
  fetchCv,
  fetchCvMatches,
  setJobMark,
  uploadCv,
  type CvMatch,
  type CvSummary,
  type JobMark,
  type JobOpening,
} from './api';
import { JobCard } from './components/JobCard';
import { formatBytes } from './components/format';

export function CvTab() {
  const [cv, setCv] = useState<CvSummary | null>(null);
  const [matches, setMatches] = useState<CvMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profile, matchResult] = await Promise.all([
        fetchCv(),
        fetchCvMatches().catch(() => null),
      ]);
      setCv(profile);
      setMatches(matchResult?.data ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const profile = await uploadCv(file);
      setCv(profile);
      const matchResult = await fetchCvMatches();
      setMatches(matchResult.data);
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await deleteCv();
      setCv(null);
      setMatches([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(false);
    }
  };

  const handleMark = async (job: JobOpening, mark: JobMark) => {
    if (pendingMarks[job.id]) return;
    const current = job.userMark;
    const next = current === mark ? null : mark;

    setPendingMarks((prev) => ({ ...prev, [job.id]: true }));
    setMatches((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, userMark: next } : j)),
    );
    try {
      const saved = await setJobMark(job.id, next);
      setMatches((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, userMark: saved } : j)),
      );
    } catch (err) {
      setError((err as Error).message);
      setMatches((prev) =>
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
    <section className="cv-tab">
      <div className="cv-upload">
        <div className="cv-upload-info">
          <h2>Your CV</h2>
          {cv ? (
            <p className="cv-status">
              <strong>{cv.fileName}</strong> · {formatBytes(cv.sizeBytes)} ·{' '}
              {cv.wordCount} words extracted
              <br />
              <span className="muted">
                Uploaded {new Date(cv.updatedAt).toLocaleString()}
              </span>
            </p>
          ) : (
            <p className="muted">
              No CV uploaded yet. Upload a PDF so the platform can filter jobs
              to those matching your profile.
            </p>
          )}
        </div>
        <div className="cv-upload-controls">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => void handleUpload(e.target.files?.[0])}
          />
          {cv && (
            <button
              className="refresh"
              onClick={() => void handleRemove()}
              disabled={removing}
            >
              {removing ? 'Removing...' : 'Remove CV'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {uploading && (
        <p className="muted">
          Reading your CV... Letting the matcher digest it.
        </p>
      )}

      <div className="cv-results">
        {loading ? (
          <p className="muted">Loading CV matches...</p>
        ) : !cv ? (
          <p className="muted">
            Upload a PDF CV above to see jobs that match your profile.
          </p>
        ) : matches.length === 0 ? (
          <p className="muted">
            No matches yet against your CV. Run the refresh on the All jobs tab
            first, or try a more detailed CV.
          </p>
        ) : (
          <>
            <p className="count">
              {matches.length} job{matches.length === 1 ? '' : 's'} matching
              your CV
            </p>
            <ul className="jobs">
              {matches.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  match={job.match}
                  markDisabled={pendingMarks[job.id]}
                  onMark={handleMark}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
