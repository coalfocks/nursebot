import { supabase } from './supabase';
import { readFunctionErrorMessage } from './feedbackService';

/**
 * Admin compare-only feedback reruns. A rerun is stored as a NEW version (feedback_rerun_versions); the saved
 * grade and feedback on the assignment are never overwritten by a rerun. Promotion is a separate, confirmed action.
 */
export const PROMOTE_CONFIRMATION = 'PROMOTE';

// Saved feedback is untyped JSON from the database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FeedbackJson = Record<string, any>;
type Json = FeedbackJson;

export type FeedbackRerunVersion = {
  id: string;
  assignment_id: string;
  status: 'running' | 'completed' | 'failed';
  technical_incomplete: boolean;
  result: Json | null;
  provenance: Json | null;
  error: string | null;
  created_at: string;
  promoted_at: string | null;
};

export type FeedbackSide = {
  label: string;
  generatedAt: string | null;
  communicationScore: number | null;
  mdmScore: number | null;
  components: Record<string, number | null>;
  safety: { level: string | null; action: string | null; rationale: string | null };
  strengths: string[];
  improvements: string[];
  provenance: { model: string | null; promptId: string | null; promptSha256: string | null; contextBlockId: string | null; contextBlockSha256: string | null; contextRenderedSha256: string | null; contextSource: string | null; contextMissing: string[] };
};

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const commentTexts = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : text((item as Json | null)?.text))).filter((item): item is string => Boolean(item)) : []);
const componentScores = (...breakdowns: unknown[]): Record<string, number | null> => {
  const out: Record<string, number | null> = {};
  for (const breakdown of breakdowns) {
    if (!breakdown || typeof breakdown !== 'object') continue;
    for (const [key, value] of Object.entries(breakdown as Json)) out[key] = num((value as Json | null)?.score);
  }
  return out;
};
const provenanceOf = (debrief: Json | null | undefined, extra: Json | null | undefined): FeedbackSide['provenance'] => {
  const source: Json = { ...(debrief ?? {}), ...(extra ?? {}) };
  return {
    model: text(source.model),
    promptId: text(source.prompt_id),
    promptSha256: text(source.prompt_sha256),
    contextBlockId: text(source.context_block_id),
    contextBlockSha256: text(source.context_block_sha256),
    contextRenderedSha256: text(source.context_rendered_sha256),
    contextSource: text(source.context_source),
    contextMissing: Array.isArray(source.context_missing) ? source.context_missing.filter((item: unknown): item is string => typeof item === 'string') : [],
  };
};

/** The saved (official) result as stored on the assignment row. Older results simply lack context provenance. */
export const sideFromAssignment = (assignment: Json): FeedbackSide => {
  const debrief = (assignment.feedback_debrief ?? {}) as Json;
  const safety = (assignment.safety_result ?? debrief.safety_result ?? {}) as Json;
  return {
    label: 'Saved (official)',
    generatedAt: text(assignment.feedback_generated_at),
    communicationScore: num(assignment.communication_score),
    mdmScore: num(assignment.mdm_score),
    components: componentScores(assignment.communication_breakdown, assignment.mdm_breakdown),
    safety: { level: text(safety.level), action: text(safety.action), rationale: text(safety.rationale) },
    strengths: commentTexts(debrief.strengths),
    improvements: commentTexts(debrief.improvements),
    provenance: provenanceOf(debrief, null),
  };
};

export const sideFromVersion = (version: FeedbackRerunVersion): FeedbackSide => {
  const result = (version.result ?? {}) as Json;
  const evaluation = (result.evaluation ?? {}) as Json;
  const debrief = (result.debrief ?? {}) as Json;
  const safety = (evaluation.safety_result ?? debrief.safety_result ?? {}) as Json;
  return {
    label: `Rerun ${new Date(version.created_at).toLocaleString()}`,
    generatedAt: text(version.provenance?.generated_at) ?? version.created_at,
    communicationScore: num(evaluation.communication_score),
    mdmScore: num(evaluation.clinical_reasoning_score ?? evaluation.mdm_score),
    components: componentScores(evaluation.communication_breakdown, evaluation.clinical_reasoning_breakdown),
    safety: { level: text(safety.level), action: text(safety.action), rationale: text(safety.rationale) },
    strengths: commentTexts(debrief.strengths),
    improvements: commentTexts(debrief.improvements),
    provenance: provenanceOf(debrief, version.provenance),
  };
};

export type ComparisonRow = { label: string; saved: string; rerun: string; changed: boolean };
const show = (value: unknown) => (value == null || value === '' ? '—' : String(value));

export const buildComparison = (saved: FeedbackSide, rerun: FeedbackSide): ComparisonRow[] => {
  const row = (label: string, a: unknown, b: unknown): ComparisonRow => ({ label, saved: show(a), rerun: show(b), changed: show(a) !== show(b) });
  const rows: ComparisonRow[] = [
    row('Communication score', saved.communicationScore, rerun.communicationScore),
    row('Medical decision-making score', saved.mdmScore, rerun.mdmScore),
  ];
  for (const key of [...new Set([...Object.keys(saved.components), ...Object.keys(rerun.components)])]) rows.push(row(`Component: ${key.replace(/_/g, ' ')}`, saved.components[key], rerun.components[key]));
  rows.push(row('Safety level', saved.safety.level, rerun.safety.level), row('Safety action', saved.safety.action, rerun.safety.action));
  rows.push(row('Strengths', saved.strengths.join(' | '), rerun.strengths.join(' | ')), row('Improvements', saved.improvements.join(' | '), rerun.improvements.join(' | ')));
  const p = (side: FeedbackSide) => side.provenance;
  rows.push(
    row('Model', p(saved).model, p(rerun).model),
    row('Evaluator prompt ID', p(saved).promptId, p(rerun).promptId),
    row('Evaluator prompt hash', p(saved).promptSha256, p(rerun).promptSha256),
    row('Context framing ID', p(saved).contextBlockId, p(rerun).contextBlockId),
    row('Context framing hash', p(saved).contextBlockSha256, p(rerun).contextBlockSha256),
    row('Context hash (rendered)', p(saved).contextRenderedSha256, p(rerun).contextRenderedSha256),
    row('Context missing fields', p(saved).contextMissing.join(', '), p(rerun).contextMissing.join(', ')),
    row('Generated at', saved.generatedAt, rerun.generatedAt),
  );
  return rows;
};

export async function startFeedbackRerun(assignmentId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('generate-feedback', { body: { assignmentId, mode: 'compare' } });
  if (error) throw new Error(await readFunctionErrorMessage(error));
  if (typeof data?.versionId !== 'string') throw new Error('Rerun did not start');
  return data.versionId;
}

export async function listFeedbackRerunVersions(assignmentId: string): Promise<FeedbackRerunVersion[]> {
  // Table is added by the (unapplied) migration, so it is not in the generated database types yet.
  const { data, error } = await (supabase as unknown as { from: (table: string) => ReturnType<typeof supabase.from> })
    .from('feedback_rerun_versions')
    .select('id, assignment_id, status, technical_incomplete, result, provenance, error, created_at, promoted_at')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as FeedbackRerunVersion[];
}

export async function promoteFeedbackRerun(assignmentId: string, versionId: string, confirm: string): Promise<void> {
  const { error } = await supabase.functions.invoke('promote-feedback-rerun', { body: { assignmentId, versionId, confirm } });
  if (error) throw new Error(await readFunctionErrorMessage(error));
}
