import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteCandidate,
  fetchCandidates,
  resolveDuplicateCandidate,
  uploadCandidate,
  type Candidate,
} from './api';
import { CandidateList } from './components/CandidateList';

export function UploadCvTab() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCandidates(await fetchCandidates());
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
      const uploaded = await uploadCandidate(file);
      await load();
      if (fileInput.current) fileInput.current.value = '';
      setToast(
        uploaded.status === 'duplicate'
          ? 'CV sanitized - same name found, please resolve below.'
          : 'CV sanitized and ready.',
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleResolveDuplicate = async (
    id: string,
    action: 'ignore' | 'replace',
  ) => {
    setResolvingId(id);
    setError(null);
    try {
      await resolveDuplicateCandidate(id, action);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResolvingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setRemovingId(id);
    setError(null);
    try {
      await deleteCandidate(id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="cv-tab">
      <div className="cv-upload">
        <div className="cv-upload-info">
          <h2>Upload a CV</h2>
          <p className="muted">
            Upload one PDF CV at a time. It's sanitized and embedded locally,
            then shows up on the Matches tab against every open role.
          </p>
        </div>
        <div className="cv-upload-controls">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => void handleUpload(e.target.files?.[0])}
          />
        </div>
      </div>

      {uploading && (
        <p className="muted">Reading and sanitizing the CV locally...</p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading candidates...</p>
      ) : (
        <CandidateList
          candidates={candidates}
          removingId={removingId}
          onDelete={(id) => void handleDelete(id)}
          resolvingId={resolvingId}
          onResolveDuplicate={(id, action) =>
            void handleResolveDuplicate(id, action)
          }
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}
