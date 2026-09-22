import type { Candidate, JobMark, JobOpening } from '../api';
import { formatDate, snippet } from './format';

interface JobCardProps {
  job: JobOpening;
  similarity?: number | null;
  skillCoverage?: number | null;
  matchedSkillCount?: number;
  requiredSkillCount?: number;
  matchedSkills?: string[];
  missingSkills?: string[];
  markDisabled?: boolean;
  onMark?: (job: JobOpening, mark: JobMark) => void;
  seenDisabled?: boolean;
  onToggleSeen?: (job: JobOpening) => void;
  candidates?: Candidate[];
  sentCvsDisabled?: boolean;
  onChangeSentCvs?: (job: JobOpening, candidateIds: string[]) => void;
}

function candidateLabel(candidate: Candidate): string {
  return candidate.candidateName || candidate.fileName;
}

export function JobCard({
  job,
  similarity,
  skillCoverage,
  matchedSkillCount,
  requiredSkillCount,
  matchedSkills,
  missingSkills,
  markDisabled,
  onMark,
  seenDisabled,
  onToggleSeen,
  candidates,
  sentCvsDisabled,
  onChangeSentCvs,
}: JobCardProps) {
  const markButton = (
    mark: JobMark,
    activeLabel: string,
    inactiveLabel: string,
    className: string,
    disabled?: boolean,
  ) => (
    <button
      className={job.userMark === mark ? `mark active ${className}` : 'mark'}
      aria-pressed={job.userMark === mark}
      disabled={markDisabled || disabled}
      onClick={() => onMark?.(job, mark)}
    >
      {job.userMark === mark ? activeLabel : inactiveLabel}
    </button>
  );

  const hasCvSent = (job.sentCvIds?.length ?? 0) > 0;

  return (
    <li className={job.seenAt ? 'job job-seen' : 'job'}>
      <div className="job-head">
        <h2>{job.title}</h2>
        <span className="status status-active">{job.status}</span>
        {job.seenAt && <span className="status status-seen">Seen</span>}
      </div>
      <div className="meta">
        <span className="company">{job.companyName}</span>
        {job.locationText && <span>{job.locationText}</span>}
        <span className="source">{job.sourceName}</span>
        {job.publishedAt && (
          <span>Published {formatDate(job.publishedAt)}</span>
        )}
      </div>
      {similarity != null && (
        <div className="match">
          <span className="match-score">
            {Math.round(similarity * 100)}% match
          </span>
          {skillCoverage != null && requiredSkillCount ? (
            <span className="match-counts">
              {matchedSkillCount}/{requiredSkillCount} required skills
            </span>
          ) : null}
        </div>
      )}
      {((matchedSkills && matchedSkills.length > 0) ||
        (missingSkills && missingSkills.length > 0)) && (
        <div className="skill-breakdown">
          {matchedSkills && matchedSkills.length > 0 && (
            <div className="skill-group skill-group-matched">
              <span className="skill-group-label">Matched skills</span>
              <div className="skill-chips">
                {matchedSkills.map((skill) => (
                  <span key={skill} className="skill-chip skill-chip-matched">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
          {missingSkills && missingSkills.length > 0 && (
            <div className="skill-group skill-group-missing">
              <span className="skill-group-label">Missing skills</span>
              <div className="skill-chips">
                {missingSkills.map((skill) => (
                  <span key={skill} className="skill-chip skill-chip-missing">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {job.description && (
        <p className="description">{snippet(job.description)}</p>
      )}
      {job.salaryText && <p className="salary">{job.salaryText}</p>}
      <div className="links">
        {job.sourceUrl && (
          <a href={job.sourceUrl} target="_blank" rel="noreferrer noopener">
            View original post
          </a>
        )}
        {job.applicationUrl && job.applicationUrl !== job.sourceUrl && (
          <a
            href={job.applicationUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Apply
          </a>
        )}
      </div>
      {onChangeSentCvs && candidates && (
        <div className="sent-cvs">
          <span className="sent-cvs-label">CVs sent</span>
          <details className="sent-cvs-picker">
            <summary>
              {job.sentCvIds.length === 0
                ? 'None selected'
                : job.sentCvIds
                    .map((id) => {
                      const candidate = candidates.find((c) => c.id === id);
                      return candidate ? candidateLabel(candidate) : null;
                    })
                    .filter(Boolean)
                    .join(', ')}
            </summary>
            <div className="sent-cvs-options">
              {candidates.length === 0 ? (
                <p className="muted">No CVs uploaded yet.</p>
              ) : (
                candidates.map((candidate) => (
                  <label key={candidate.id} className="sent-cvs-option">
                    <input
                      type="checkbox"
                      checked={job.sentCvIds.includes(candidate.id)}
                      disabled={sentCvsDisabled}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...job.sentCvIds, candidate.id]
                          : job.sentCvIds.filter((id) => id !== candidate.id);
                        onChangeSentCvs(job, next);
                      }}
                    />
                    {candidateLabel(candidate)}
                  </label>
                ))
              )}
            </div>
          </details>
        </div>
      )}
      {(onMark || onToggleSeen) && (
        <div className="marks">
          {onToggleSeen && (
            <button
              className={job.seenAt ? 'mark active seen' : 'mark'}
              aria-pressed={!!job.seenAt}
              disabled={seenDisabled}
              onClick={() => onToggleSeen(job)}
            >
              {job.seenAt ? 'Seen' : 'Mark as seen'}
            </button>
          )}
          {onMark &&
            markButton('applied', 'Applied', 'Apply', 'applied', !hasCvSent)}
          {onMark &&
            markButton(
              'not_interested',
              'Not interested',
              'Interested',
              'not-interested',
            )}
        </div>
      )}
    </li>
  );
}
