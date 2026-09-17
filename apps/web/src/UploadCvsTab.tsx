import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteCandidate,
  fetchCandidates,
  resolveDuplicateCandidate,
  uploadCandidate,
  type Candidate,
} from './api';
import { CandidateList } from './components/CandidateList';

const PENDING_ID_PREFIX = 'pending-upload-';

function pendingCandidate(file: File, index: number): Candidate {
  return {
    id: `${PENDING_ID_PREFIX}${index}-${file.name}`,
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    wordCount: 0,
    candidateName: null,
    status: 'pending',
    error: null,
    duplicateOfId: null,
    updatedAt: new Date().toISOString(),
  };
}

export function UploadCvsTab() {
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

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    const placeholders = selected.map(pendingCandidate);

    setUploading(true);
    setError(null);
    setCandidates((prev) => [...placeholders, ...prev]);
    if (fileInput.current) fileInput.current.value = '';

    const uploaded: Candidate[] = [];
    for (let i = 0; i < selected.length; i++) {
      const placeholderId = placeholders[i].id;
      try {
        const candidate = await uploadCandidate(selected[i]);
        uploaded.push(candidate);
        setCandidates((prev) =>
          prev.map((c) => (c.id === placeholderId ? candidate : c)),
        );
      } catch (err) {
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === placeholderId
              ? { ...c, status: 'failed', error: (err as Error).message }
              : c,
          ),
        );
      }
    }

    const duplicates = uploaded.filter((c) => c.status === 'duplicate').length;
    setToast(
      duplicates > 0
        ? `${uploaded.length} CV${uploaded.length === 1 ? '' : 's'} sanitized - ${duplicates} need${duplicates === 1 ? 's' : ''} a duplicate resolved below.`
        : `${uploaded.length} CV${uploaded.length === 1 ? '' : 's'} sanitized and ready.`,
    );
    setUploading(false);
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
          <h2>Upload multiple CVs</h2>
          <p className="muted">
            Select several PDF CVs at once. Each is sanitized and embedded
            locally in turn, so a large batch takes a while - the list below
            fills in as each one finishes.
          </p>
        </div>
        <div className="cv-upload-controls">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => void handleUpload(e.target.files)}
          />
        </div>
      </div>

      {uploading && (
        <p className="muted">Reading and sanitizing CVs locally...</p>
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
