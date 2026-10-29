import type { EvaluationTimelineEntry } from './assignment-timeline.ts';

const hasMeta = (entry: EvaluationTimelineEntry, pattern: RegExp) =>
  (entry.meta ?? []).some((value) => pattern.test(value));

const isLearnerAuthored = (entry: EvaluationTimelineEntry) =>
  entry.kind === 'learner-action' || hasMeta(entry, /\bAuthor: Student\b/i);

export const buildLearnerCommunicationEvidenceIds = (entries: EvaluationTimelineEntry[]) =>
  entries.filter(isLearnerAuthored).map((entry) => entry.id);

export const buildLearnerClosedLoopEvidenceIds = (entries: EvaluationTimelineEntry[]) =>
  entries
    .filter((entry) => {
      if (!isLearnerAuthored(entry)) return false;
      if (entry.kind === 'consultant-message' || entry.kind === 'message') return true;
      if (entry.kind !== 'learner-action') return false;
      return hasMeta(entry, /team|escalat/i) || /team|escalat/i.test(`${entry.title} ${entry.body ?? ''}`);
    })
    .map((entry) => entry.id);
