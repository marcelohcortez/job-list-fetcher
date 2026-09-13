import type { CvMatchDetails, JobMark, JobOpening } from '../api';
import { formatDate, snippet } from './format';

interface JobCardProps {
  job: JobOpening;
  match?: CvMatchDetails | null;
  markDisabled?: boolean;
  onMark?: (job: JobOpening, mark: JobMark) => void;
}

export function JobCard({ job, match, markDisabled, onMark }: JobCardProps) {
  const markButton = (mark: JobMark, label: string, className: string) => (
    <button
      className={job.userMark === mark ? `mark active ${className}` : 'mark'}
      aria-pressed={job.userMark === mark}
      disabled={markDisabled}
      onClick={() => onMark?.(job, mark)}
    >
      {job.userMark === mark ? label : label.replace('Marked', 'Mark as')}
    </button>
  );

  return (
    <li className="job">
      <div className="job-head">
        <h2>{job.title}</h2>
        <span className="status status-active">{job.status}</span>
      </div>
      <div className="meta">
        <span className="company">{job.companyName}</span>
        {job.locationText && <span>{job.locationText}</span>}
        <span className="source">{job.sourceName}</span>
        {job.publishedAt && (
          <span>Published {formatDate(job.publishedAt)}</span>
        )}
      </div>
      {match && (
        <div className="match">
          <span className="match-score">Match {match.score}</span>
          <span className="match-counts">
            {match.titleHits} title · {match.bodyMatches} skill matches
          </span>
          {match.matchedPhrases.length > 0 && (
            <span className="chips">
              {match.matchedPhrases.map((phrase) => (
                <span key={phrase} className="chip">
                  {phrase}
                </span>
              ))}
            </span>
          )}
          {match.matchedTerms.length > 0 && (
            <span className="chips terms">
              {match.matchedTerms.slice(0, 12).map((term) => (
                <span key={term} className="chip term">
                  {term}
                </span>
              ))}
            </span>
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
      {onMark && (
        <div className="marks">
          {markButton('applied', 'Marked applied', 'applied')}
          {markButton(
            'not_interested',
            'Marked not interested',
            'not-interested',
          )}
        </div>
      )}
    </li>
  );
}
