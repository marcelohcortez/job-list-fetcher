import type { Candidate } from '../api';
import { formatBytes } from './format';

interface CandidateListProps {
  candidates: Candidate[];
  removingId: string | null;
  onDelete: (id: string) => void;
  resolvingId?: string | null;
  onResolveDuplicate?: (id: string, action: 'ignore' | 'replace') => void;
}

const STATUS_LABEL: Record<Candidate['status'], string> = {
  pending: 'Sanitizing...',
  sanitized: 'Ready',
  failed: 'Failed',
  duplicate: 'Possible duplicate',
};

export function CandidateList({
  candidates,
  removingId,
  onDelete,
  resolvingId,
  onResolveDuplicate,
}: CandidateListProps) {
  if (candidates.length === 0) {
    return <p className="muted">No CVs uploaded yet.</p>;
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));

  return (
    <ul className="candidates">
      {candidates.map((candidate) => (
        <li key={candidate.id} className="candidate">
          <div className="candidate-info">
            <strong>{candidate.candidateName ?? candidate.fileName}</strong>
            {candidate.candidateTitle && (
              <span className="muted">{candidate.candidateTitle}</span>
            )}
            <span className={`status status-${candidate.status}`}>
              {STATUS_LABEL[candidate.status]}
            </span>
          </div>
          <div className="meta">
            <span>{candidate.fileName}</span>
            <span>{formatBytes(candidate.sizeBytes)}</span>
            <span>{candidate.wordCount} words</span>
            <span className="muted">
              {new Date(candidate.updatedAt).toLocaleString()}
            </span>
          </div>
          {candidate.status === 'failed' && candidate.error && (
            <p className="error" role="alert">
              {candidate.error}
            </p>
          )}
          {candidate.status === 'duplicate' && candidate.duplicateOfId && (
            <div className="warning" role="alert">
              <p>
                Same name and role as an existing CV,{' '}
                <strong>
                  {byId.get(candidate.duplicateOfId)?.fileName ??
                    'an existing candidate'}
                </strong>
                . Keep the existing one and ignore this upload, or replace it
                with this new CV?
              </p>
              <div className="candidate-duplicate-actions">
                <button
                  className="refresh"
                  onClick={() => onResolveDuplicate?.(candidate.id, 'ignore')}
                  disabled={resolvingId === candidate.id}
                >
                  {resolvingId === candidate.id
                    ? 'Working...'
                    : 'Ignore new upload'}
                </button>
                <button
                  className="refresh"
                  onClick={() => onResolveDuplicate?.(candidate.id, 'replace')}
                  disabled={resolvingId === candidate.id}
                >
                  {resolvingId === candidate.id
                    ? 'Working...'
                    : 'Replace existing'}
                </button>
              </div>
            </div>
          )}
          <button
            className="refresh"
            onClick={() => onDelete(candidate.id)}
            disabled={removingId === candidate.id}
          >
            {removingId === candidate.id ? 'Removing...' : 'Remove'}
          </button>
        </li>
      ))}
    </ul>
  );
}
