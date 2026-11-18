// Explicit per-source coverage for the scoring prompt and the saved result.
// "available_empty" means the source query succeeded and returned no rows.
// That is a complete empty source, never a missing one, so an observed
// omission can be assessed. "unavailable" means the source could not be read.

export type SourceStatus = 'available_with_events' | 'available_empty' | 'unavailable' | 'not_applicable';

export const COVERAGE_SOURCES = [
  'nurse_messages',
  'patient_messages',
  'consultant_messages',
  'learner_actions',
  'orders_results',
  'progress_note',
  'case_key',
] as const;

export type SourceCoverage = Record<(typeof COVERAGE_SOURCES)[number], SourceStatus>;

export type CoverageEntry = { kind: string; actor_role?: string | null };

const LEARNER_ROLES = ['student', 'user', 'learner'];

export const buildSourceCoverage = (
  entries: CoverageEntry[],
  options: { manifestAvailable: boolean; progressNotePresent: boolean; caseKeyGoalCount: number },
): SourceCoverage => {
  const status = (count: number, readable: boolean): SourceStatus => {
    if (!readable) return 'unavailable';
    return count > 0 ? 'available_with_events' : 'available_empty';
  };
  const role = (entry: CoverageEntry) => (entry.actor_role ?? '').toLowerCase();
  const count = (predicate: (entry: CoverageEntry) => boolean) => entries.filter(predicate).length;
  const readable = options.manifestAvailable;
  return {
    nurse_messages: status(count((e) => role(e) === 'assistant' || role(e) === 'nurse'), readable),
    patient_messages: status(count((e) => role(e) === 'patient'), readable),
    consultant_messages: status(count((e) => role(e) === 'consultant' || e.kind === 'consultant-message'), readable),
    learner_actions: status(count((e) => LEARNER_ROLES.includes(role(e)) && e.kind !== 'progress-note'), readable),
    orders_results: status(count((e) => ['order', 'labs', 'imaging', 'vital'].includes(e.kind)), readable),
    progress_note: options.progressNotePresent
      ? 'available_with_events'
      : readable ? 'available_empty' : 'unavailable',
    case_key: options.caseKeyGoalCount > 0 ? 'available_with_events' : 'unavailable',
  };
};

// A component is only unassessable because of a source when that source is
// unavailable. Empty-but-available sources support a genuine zero or omission.
export const sourceIsReadable = (coverage: SourceCoverage, source: keyof SourceCoverage) =>
  coverage[source] !== 'unavailable';
