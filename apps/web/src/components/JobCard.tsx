import { useRef, useState } from 'react';
import type { Candidate, JobMark, JobOpening, LayaVerdict } from '../api';
import { formatDate } from './format';

interface JobCardProps {
  job: JobOpening;
  similarity?: number | null;
  baseScore?: number | null;
  skillCoverage?: number | null;
  matchedSkillCount?: number;
  requiredSkillCount?: number;
  matchedSkills?: string[];
  missingSkills?: string[];
  layaScore?: number | null;
  layaChoice?: LayaVerdict | null;
  layaReasoning?: string | null;
  layaMismatchReasoning?: string | null;
  layaTruncated?: boolean;
  markDisabled?: boolean;
  onMark?: (job: JobOpening, mark: JobMark) => void;
  seenDisabled?: boolean;
  onToggleSeen?: (job: JobOpening) => void;
  candidates?: Candidate[];
  sentCvsDisabled?: boolean;
  onChangeSentCvs?: (job: JobOpening, candidateIds: string[]) => void;
  topMatchNames?: string[];
}

function candidateLabel(candidate: Candidate): string {
  const name = candidate.candidateName || candidate.fileName;
  return candidate.candidateTitle ? `${name} - ${candidate.candidateTitle}` : name;
}

function sortedByLabel(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) =>
    candidateLabel(a).localeCompare(candidateLabel(b)),
  );
}

const VISIBLE_SKILL_CAP = 6;

function SkillChipGroup({
  label,
  skills,
  variant,
}: {
  label: string;
  skills: string[];
  variant: 'matched' | 'missing';
}) {
  const visible = skills.slice(0, VISIBLE_SKILL_CAP);
  const rest = skills.slice(VISIBLE_SKILL_CAP);

  return (
    <div className={`skill-group skill-group-${variant}`}>
      <span className="skill-group-label">{label}</span>
      <div className="skill-chips">
        {visible.map((skill) => (
          <span key={skill} className={`skill-chip skill-chip-${variant}`}>
            {skill}
          </span>
        ))}
        {rest.length > 0 && (
          <details className="skill-chip-more">
            <summary>+{rest.length} more</summary>
            <div className="skill-chips">
              {rest.map((skill) => (
                <span key={skill} className={`skill-chip skill-chip-${variant}`}>
                  {skill}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function MatchReasoning({
  layaReasoning,
  matchedSkills,
}: {
  layaReasoning?: string | null;
  matchedSkills?: string[];
}) {
  return (
    <details className="match-collapsible match-reasoning-details">
      <summary>Why this could be a good match</summary>
      <div className="match-collapsible-body">
        {layaReasoning ? (
          <p>{layaReasoning}</p>
        ) : matchedSkills && matchedSkills.length > 0 ? (
          <p>Matched skills: {matchedSkills.join(', ')}</p>
        ) : (
          <p className="muted">No match reasoning available yet.</p>
        )}
      </div>
    </details>
  );
}

function MatchMismatch({
  layaMismatchReasoning,
  missingSkills,
}: {
  layaMismatchReasoning?: string | null;
  missingSkills?: string[];
}) {
  return (
    <details className="match-collapsible match-mismatch-details">
      <summary>Possible mismatch</summary>
      <div className="match-collapsible-body">
        {layaMismatchReasoning ? (
          <p>{layaMismatchReasoning}</p>
        ) : missingSkills && missingSkills.length > 0 ? (
          <p>Missing skills: {missingSkills.join(', ')}</p>
        ) : (
          <p className="muted">No obvious mismatches identified.</p>
        )}
      </div>
    </details>
  );
}

function SkillBreakdown({
  matchedSkills,
  missingSkills,
}: {
  matchedSkills?: string[];
  missingSkills?: string[];
}) {
  return (
    <div className="skill-breakdown">
      {matchedSkills && matchedSkills.length > 0 && (
        <SkillChipGroup
          label="Matched skills"
          skills={matchedSkills}
          variant="matched"
        />
      )}
      {missingSkills && missingSkills.length > 0 && (
        <SkillChipGroup
          label="Missing skills"
          skills={missingSkills}
          variant="missing"
        />
      )}
    </div>
  );
}

export function JobCard({
  job,
  similarity,
  baseScore,
  matchedSkills,
  missingSkills,
  layaScore,
  layaChoice,
  layaReasoning,
  layaMismatchReasoning,
  layaTruncated,
  markDisabled,
  onMark,
  seenDisabled,
  onToggleSeen,
  candidates,
  sentCvsDisabled,
  onChangeSentCvs,
  topMatchNames,
}: JobCardProps) {
  const [sentCvsSearch, setSentCvsSearch] = useState('');
  const [pendingSelection, setPendingSelection] = useState<string[] | null>(null);
  const selectedCvIds = pendingSelection ?? job.sentCvIds;
  const sentCvsDetailsRef = useRef<HTMLDetailsElement>(null);
  const markButton = (
    mark: JobMark,
    activeLabel: string,
    inactiveLabel: string,
    className: string,
    disabled?: boolean,
    onClick?: () => void,
  ) => (
    <button
      className={job.userMark === mark ? `mark active ${className}` : 'mark'}
      aria-pressed={job.userMark === mark}
      disabled={markDisabled || disabled}
      onClick={() => {
        onClick?.();
        onMark?.(job, mark);
      }}
    >
      {job.userMark === mark ? activeLabel : inactiveLabel}
    </button>
  );

  return (
    <li className={job.userMark === 'dead' ? 'job job-dead' : job.seenAt ? 'job job-seen' : 'job'}>
      <div className="job-head">
        <h2>{job.title}</h2>
        {job.userMark === 'dead' && (
          <span className="status status-dead">Dead</span>
        )}
        {job.userMark !== 'dead' && job.seenAt && (
          <span className="status status-seen">Seen</span>
        )}
      </div>
      <div className="meta">
        <span className="company">{job.companyName}</span>
        {job.locationText && <span>{job.locationText}</span>}
        <span className="source">{job.sourceName}</span>
        {job.publishedAt && (
          <span>Published {formatDate(job.publishedAt)}</span>
        )}
      </div>
      {(baseScore ?? similarity) != null && (
        <p className="match">
          <span className="match-score">
            {Math.round((baseScore ?? similarity)! * 100)}% skill/vector match
          </span>
        </p>
      )}
      {layaScore != null && layaChoice != null && (
        <p className="match laya-match">
          <span className="match-score">{Math.round(layaScore * 100)}% Laya match</span>
          <span className={`laya-choice laya-choice-${layaChoice}`}> {layaChoice}</span>
          {layaTruncated && (
            <span
              className="laya-truncated-badge"
              title="Laya's token budget cut off part of the combined job/CV text for this evaluation - its score and reasoning may be based on incomplete input."
            >
              {' '}
              ⚠ partial text read
            </span>
          )}
        </p>
      )}
      {(baseScore ?? similarity) != null && layaScore != null && (
        <p className="match overall-match">
          <span className="match-score">
            {Math.round((((baseScore ?? similarity)! + layaScore) / 2) * 100)}% overall match
          </span>
        </p>
      )}
      {((matchedSkills && matchedSkills.length > 0) ||
        (missingSkills && missingSkills.length > 0)) && (
        <SkillBreakdown matchedSkills={matchedSkills} missingSkills={missingSkills} />
      )}
      {(matchedSkills || missingSkills || layaReasoning) && (
        <div className="match-collapsibles">
          <MatchReasoning layaReasoning={layaReasoning} matchedSkills={matchedSkills} />
          <MatchMismatch
            layaMismatchReasoning={layaMismatchReasoning}
            missingSkills={missingSkills}
          />
        </div>
      )}
      {job.salaryText && <p className="salary">{job.salaryText}</p>}
      <div className="links">
        {job.sourceUrl && (
          <a
            className="btn-view-original"
            href={job.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            View original post
          </a>
        )}
      </div>
      {topMatchNames && topMatchNames.length > 0 && (
        <p className="top-matches">
          <span className="top-matches-label">Likely matches:</span>{' '}
          {topMatchNames.join(', ')}
        </p>
      )}
      {onChangeSentCvs && candidates && (
        <div className="sent-cvs">
          <span className="sent-cvs-label">CVs sent</span>
          <details
            ref={sentCvsDetailsRef}
            className="sent-cvs-picker"
            onToggle={(e) => {
              const opened = (e.currentTarget as HTMLDetailsElement).open;
              if (opened) {
                setPendingSelection(job.sentCvIds);
                return;
              }
              if (pendingSelection !== null) {
                const changed =
                  pendingSelection.length !== job.sentCvIds.length ||
                  pendingSelection.some((id) => !job.sentCvIds.includes(id));
                if (changed) onChangeSentCvs(job, pendingSelection);
                setPendingSelection(null);
              }
              setSentCvsSearch('');
            }}
          >
            <summary>
              {job.sentCvIds.length === 0
                ? 'None selected'
                : sortedByLabel(
                    candidates.filter((c) => job.sentCvIds.includes(c.id)),
                  )
                    .map(candidateLabel)
                    .join(', ')}
            </summary>
            {candidates.length === 0 ? (
              <p className="muted">No CVs uploaded yet.</p>
            ) : (
              <>
                <input
                  type="text"
                  className="sent-cvs-search"
                  placeholder="Search candidates..."
                  value={sentCvsSearch}
                  onChange={(e) => setSentCvsSearch(e.target.value)}
                />
                <div className="sent-cvs-options">
                  {sortedByLabel(candidates)
                    .filter((candidate) =>
                      candidateLabel(candidate)
                        .toLowerCase()
                        .includes(sentCvsSearch.trim().toLowerCase()),
                    )
                    .map((candidate) => (
                      <label key={candidate.id} className="sent-cvs-option">
                        <input
                          type="checkbox"
                          checked={selectedCvIds.includes(candidate.id)}
                          disabled={sentCvsDisabled}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...selectedCvIds, candidate.id]
                              : selectedCvIds.filter((id) => id !== candidate.id);
                            setPendingSelection(next);
                          }}
                        />
                        {candidateLabel(candidate)}
                      </label>
                    ))}
                </div>
                <button
                  type="button"
                  className="sent-cvs-save"
                  disabled={sentCvsDisabled}
                  onClick={() => {
                    if (sentCvsDetailsRef.current) sentCvsDetailsRef.current.open = false;
                  }}
                >
                  Save
                </button>
              </>
            )}
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
            markButton('saved', 'Saved', 'Save', 'saved')}
          {onMark &&
            markButton('dead', 'Dead', 'Mark dead', 'dead')}
        </div>
      )}
    </li>
  );
}
