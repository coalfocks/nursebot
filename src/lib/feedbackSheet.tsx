import React from 'react';

type AnyRecord = Record<string, unknown>;

// Shared display labels. The preview (FeedbackSheet) and the downloaded/printed HTML
// (renderFeedbackSheetHtml) both read these, so the wording cannot drift between them.
export const FEEDBACK_SHEET_LABELS = {
  title: 'Review your feedback',
  kicker: 'Formative feedback · attempt-specific debrief',
  caseGoals: 'Case goals',
  communication: 'Communication',
  clinicalReasoning: 'Clinical reasoning',
  separateSafety: 'Separate safety result',
  commentError: 'Commentary unavailable',
  commentErrorBody: 'Scores above were saved.',
  commentIntegrity: 'Saved comments failed the two-and-two check',
  strengths: 'Specific strengths',
  improvements: 'Actionable improvements',
  notRecorded: 'Not recorded.',
  notScored: 'Not scored',
  dateNotRecorded: 'date not recorded',
  studentFallback: 'Student',
  roomFallback: '—',
  noSafetyDetail: 'No further safety detail was recorded.',
} as const;

// The learner sheet shows exactly this many distinct strengths and improvements.
export const FEEDBACK_COMMENTS_PER_SECTION = 2;

export type FeedbackSheetAssignment = AnyRecord & {
  room?: { room_number?: string | null } | null;
};

export type FeedbackSheetModel = {
  commentError?: string | null;
  // Count and duplicate problems in the stored comments. Empty when the result is valid.
  // The renderer never pads, truncates, or merges comments to hide these.
  commentIntegrity: string[];
  studentName: string;
  roomNumber: string;
  generatedAt: string | null;
  version: string | null;
  goals: string[];
  summary: string | null;
  communicationScore: number | null;
  communication: Array<{ label: string; score: string; feedback: string; notScoredReason: string | null }>;
  clinicalReasoningScore: number | null;
  clinicalReasoning: Array<{ label: string; score: string; feedback: string; notScoredReason: string | null }>;
  safety: { level: string; detail: string } | null;
  actions: Array<{ label: string; detail: string }>;
  strengths: string[];
  improvements: string[];
};

const record = (value: unknown): AnyRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};

const text = (...values: unknown[]): string => {
  const value = values.find((item) => typeof item === 'string' && item.trim());
  return typeof value === 'string' ? value.trim() : '';
};

// Saved strengths and improvements are {text, evidence_event_ids} objects. Accept them as text;
// dropping objects made the sheet fall back to legacy single-item lists (one strength shown).
const commentText = (item: unknown): string | null => typeof item === 'string'
  ? item
  : item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : null;

// Text of each comment, trimmed. Empty entries are dropped; nothing else is removed, merged, or capped.
const commentList = (value: unknown): string[] => (Array.isArray(value) ? value : [value])
  .map(commentText)
  .map((item) => (item ?? '').trim())
  .filter(Boolean);

// A field is "absent" only when it is missing or blank. A present empty array is a real saved answer
// and must not fall through to a legacy copy.
const isAbsent = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && !value.trim());

// The first present source wins, whole. Sources are never concatenated.
const firstPresentComments = (...values: unknown[]): string[] => {
  const found = values.find((value) => !isAbsent(value));
  return found === undefined ? [] : commentList(found);
};

const commentKey = (item: string) => item.replace(/\s+/g, ' ').trim().toLowerCase();

export const commentIntegrityErrors = (label: string, items: string[]): string[] => {
  const errors: string[] = [];
  if (items.length !== FEEDBACK_COMMENTS_PER_SECTION) errors.push(`${label}: ${items.length} saved (expected ${FEEDBACK_COMMENTS_PER_SECTION})`);
  if (new Set(items.map(commentKey)).size !== items.length) errors.push(`${label}: contains duplicate text`);
  return errors;
};

const cleanReaderList = (...values: unknown[]): string[] => {
  const blocked = /reveal this goal only in post-case feedback|do not disclose the target diagnosis|do not reveal .*goal|review the evidence-linked strengths|you are evaluating|after the simulation, you should be able to|goals of (?:this )?case|target diagnosis\s*[—:-]/i;
  const output: string[] = [];
  for (const value of values) {
    for (const item of commentList(value)) {
      const cleaned = item
        .replace(/reveal this goal only in post-case feedback\.?/gi, '')
        .replace(/do not disclose the target diagnosis or goals through nurse or patient conversation before case completion\.?/gi, '')
        .replace(/review the evidence-linked strengths and next steps below\.?/gi, '')
        .replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 12 && !blocked.test(cleaned) && !output.includes(cleaned)) output.push(cleaned);
    }
  }
  return output.slice(0, 5);
};

const score = (value: unknown): string => typeof value === 'number' ? String(value) : FEEDBACK_SHEET_LABELS.notScored;

const breakdownItem = (source: AnyRecord, ...keys: string[]) => {
  const item = record(keys.map((key) => source[key]).find((value) => value !== undefined));
  const reason = text(item.not_scored_reason, item.notScoredReason) || null;
  return { score: score(item.score), feedback: text(item.feedback) || reason || (item.score === null ? 'Not assessed.' : FEEDBACK_SHEET_LABELS.notRecorded), notScoredReason: reason };
};

export function mapFeedbackSheet(assignment: FeedbackSheetAssignment): FeedbackSheetModel {
  const debrief = record(assignment.feedback_debrief);
  const communicationSource = record(assignment.communication_breakdown);
  const clinicalSource = record(assignment.clinical_reasoning_breakdown ?? assignment.mdm_breakdown);
  const actionReviewValue = debrief.action_review ?? debrief.action_order_review ?? assignment.action_review ?? assignment.order_review;
  const actionReview = record(actionReviewValue);
  const safetyResult = record(assignment.safety_result ?? debrief.safety_result);
  const savedSafetyDeduction = record(clinicalSource.safety_deduction);
  const legacy = record(assignment.nurse_feedback);
  const legacyClinical = record(legacy.clinical_reasoning);
  const legacyCommunication = record(legacy.communication_skills);

  const communication = [
    ['Focused information gathering (0–2)', 'focused_information_gathering', 'information_sharing'],
    ['Closed-loop team communication (0–3)', 'closed_loop_team_communication', 'responsive_communication'],
    ['Efficiency deduction (−2–0)', 'efficiency_deduction'],
  ].map(([label, ...keys]) => ({ label, ...breakdownItem(communicationSource, ...keys) }));
  const clinicalReasoning = [
    ['Orders/monitoring quality (0–3)', 'orders_monitoring_quality', 'labs_orders_quality'],
    ['Clinical reasoning/documentation (0–2)', 'clinical_reasoning_documentation', 'note_thought_process'],
    ['Safety deduction (0, −1, −2)', 'safety_deduction'],
  ].map(([label, ...keys]) => ({ label, ...breakdownItem(clinicalSource, ...keys) }));
  const actionValues = Array.isArray(actionReviewValue)
    ? actionReviewValue
    : Array.isArray(actionReview.items)
      ? actionReview.items
      : [...(Array.isArray(actionReview.actions) ? actionReview.actions : []), ...(Array.isArray(actionReview.orders) ? actionReview.orders : [])];

  // Canonical comments are the newest saved arrays. Legacy copies are used only when the canonical
  // field is absent, so a result never shows the canonical and legacy lists side by side.
  const strengths = firstPresentComments(debrief.strengths, assignment.strengths, legacyClinical.strengths, legacyCommunication.strengths);
  const improvements = firstPresentComments(debrief.improvements, debrief.areas_for_improvement, assignment.improvements, legacyClinical.areas_for_improvement, legacyCommunication.areas_for_improvement);
  const commentError = text(debrief.comment_error) || null;

  return {
    studentName: text(assignment.student_name, record(assignment.student).full_name) || FEEDBACK_SHEET_LABELS.studentFallback,
    roomNumber: text(assignment.room_number, assignment.room && assignment.room.room_number) || FEEDBACK_SHEET_LABELS.roomFallback,
    generatedAt: text(assignment.feedback_generated_at) || null,
    version: text(assignment.feedback_version, assignment.feedback_schema_version, debrief.version, debrief.schema_version) || null,
    goals: cleanReaderList(debrief.case_goals, debrief.goals, assignment.goals, record(assignment.room).case_goals),
    summary: null,
    communicationScore: typeof assignment.communication_score === 'number' ? assignment.communication_score : null,
    communication: communication.map((item, index) => ({
      ...item,
      score: item.score === FEEDBACK_SHEET_LABELS.notScored && index < 2 ? breakdownItem(legacyCommunication, index === 0 ? 'information_sharing' : 'responsive_communication').score : item.score,
      feedback: item.feedback === 'Not assessed.' && index < 2 ? text(legacyCommunication.comments) || item.feedback : item.feedback,
    })),
    clinicalReasoningScore: typeof (assignment.clinical_reasoning_score ?? assignment.mdm_score) === 'number' ? (assignment.clinical_reasoning_score ?? assignment.mdm_score) as number : null,
    clinicalReasoning: clinicalReasoning.map((item) => ({
      ...item,
      feedback: item.feedback === 'Not assessed.' ? text(legacyClinical.comments) || item.feedback : item.feedback,
    })),
    safety: text(safetyResult.level, safetyResult.result) ? {
      level: text(safetyResult.level, safetyResult.result),
      detail: text(safetyResult.rationale, safetyResult.action, safetyResult.feedback) || FEEDBACK_SHEET_LABELS.noSafetyDetail,
    } : typeof savedSafetyDeduction.score === 'number' || typeof savedSafetyDeduction.feedback === 'string' && savedSafetyDeduction.feedback.trim() ? {
      level: `Safety deduction: ${typeof savedSafetyDeduction.score === 'number' ? savedSafetyDeduction.score : 'Not recorded'}`,
      detail: text(savedSafetyDeduction.feedback) || FEEDBACK_SHEET_LABELS.noSafetyDetail,
    } : null,
    actions: actionValues.map((item) => {
      const action = record(item);
      return { label: text(action.label, action.action, action.order, 'Observed action/order'), detail: text(action.assessment, action.explanation, action.status, action.feedback) || 'No review detail was recorded.' };
    }),
    commentError,
    commentIntegrity: [
      ...(commentError ? [] : commentIntegrityErrors('Strengths', strengths)),
      ...(commentError ? [] : commentIntegrityErrors('Improvements', improvements)),
    ],
    strengths,
    improvements,
  };
}

export function FeedbackSheet({ model, className = '' }: { model: FeedbackSheetModel; className?: string }) {
  const listSection = (title: string, values: string[], tone = '') => (
    <section className={`rounded-lg border p-4 ${tone}`}><h2 className="font-semibold text-gray-900">{title}</h2>{values.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">{values.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-gray-500">{FEEDBACK_SHEET_LABELS.notRecorded}</p>}</section>
  );
  return <article className={`feedback-sheet space-y-4 bg-white text-gray-900 ${className}`}>
    <header className="border-b border-gray-300 pb-3"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">{FEEDBACK_SHEET_LABELS.kicker}</p><h1 className="mt-1 text-2xl font-bold">{FEEDBACK_SHEET_LABELS.title}</h1><p className="mt-1 text-sm text-gray-600">{model.studentName} · Room {model.roomNumber}</p><p className="text-xs text-gray-500">Recorded {model.generatedAt ? new Date(model.generatedAt).toLocaleString() : FEEDBACK_SHEET_LABELS.dateNotRecorded}{model.version ? ` · Version ${model.version}` : ''}</p></header>
    {listSection(FEEDBACK_SHEET_LABELS.caseGoals, model.goals)}
    <div className="grid gap-4 md:grid-cols-2">{[[FEEDBACK_SHEET_LABELS.communication, model.communicationScore, model.communication], [FEEDBACK_SHEET_LABELS.clinicalReasoning, model.clinicalReasoningScore, model.clinicalReasoning]].map(([title, total, rows]) => <section key={title as string} className="rounded-lg border p-4"><div className="flex items-baseline justify-between"><h2 className="font-semibold">{title as string}</h2><strong className="text-xl text-blue-700">{typeof total === 'number' ? `${total}/5` : FEEDBACK_SHEET_LABELS.notScored}</strong></div><div className="mt-3 space-y-3">{(rows as FeedbackSheetModel['communication']).map((item) => <div key={item.label}><p className="text-sm font-medium">{item.label}: {item.score}</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{item.notScoredReason || item.feedback}</p></div>)}</div></section>)}</div>
    {model.safety && <section className="rounded-lg border p-4"><h2 className="font-semibold">{FEEDBACK_SHEET_LABELS.separateSafety}</h2><p className="mt-2 text-sm font-medium">{model.safety.level}</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{model.safety.detail}</p></section>}
    {model.commentIntegrity.length > 0 && <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4"><h2 className="font-semibold">{FEEDBACK_SHEET_LABELS.commentIntegrity}</h2><ul className="mt-1 list-disc pl-5 text-sm text-gray-700">{model.commentIntegrity.map((item) => <li key={item}>{item}</li>)}</ul></section>}
    {model.commentError && <section className="rounded-lg border border-red-200 bg-red-50 p-4"><h2 className="font-semibold">{FEEDBACK_SHEET_LABELS.commentError}</h2><p className="mt-1 text-sm text-gray-700">{FEEDBACK_SHEET_LABELS.commentErrorBody} {model.commentError}</p></section>}
    {listSection(FEEDBACK_SHEET_LABELS.strengths, model.strengths)}
    {listSection(FEEDBACK_SHEET_LABELS.improvements, model.improvements, 'border-amber-200 bg-amber-50')}
  </article>;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
const htmlList = (values: string[]) => values.length ? `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<p class="missing">${FEEDBACK_SHEET_LABELS.notRecorded}</p>`;
const htmlSection = (title: string, content: string, className = '') => `<section class="section ${className}"><h2>${escapeHtml(title)}</h2>${content}</section>`;

export function renderFeedbackSheetHtml(model: FeedbackSheetModel): string {
  const scoreSection = (title: string, total: number | null, rows: FeedbackSheetModel['communication']) => htmlSection(title, `<strong class="total">${total === null ? FEEDBACK_SHEET_LABELS.notScored : `${total}/5`}</strong>${rows.map((item) => `<div class="row"><b>${escapeHtml(item.label)}: ${escapeHtml(item.score)}</b><p>${escapeHtml(item.notScoredReason || item.feedback)}</p></div>`).join('')}`, 'score');
  return `<article class="sheet"><header><p class="kicker">${escapeHtml(FEEDBACK_SHEET_LABELS.kicker)}</p><h1>${escapeHtml(FEEDBACK_SHEET_LABELS.title)}</h1><p>${escapeHtml(model.studentName)} · Room ${escapeHtml(model.roomNumber)}</p><small>Recorded ${escapeHtml(model.generatedAt ? new Date(model.generatedAt).toLocaleString() : FEEDBACK_SHEET_LABELS.dateNotRecorded)}${model.version ? ` · Version ${escapeHtml(model.version)}` : ''}</small></header>${htmlSection(FEEDBACK_SHEET_LABELS.caseGoals, htmlList(model.goals))}<div class="grid">${scoreSection(FEEDBACK_SHEET_LABELS.communication, model.communicationScore, model.communication)}${scoreSection(FEEDBACK_SHEET_LABELS.clinicalReasoning, model.clinicalReasoningScore, model.clinicalReasoning)}</div>${model.safety ? htmlSection(FEEDBACK_SHEET_LABELS.separateSafety, `<b>${escapeHtml(model.safety.level)}</b><p class="pre">${escapeHtml(model.safety.detail)}</p>`, 'safety') : ''}${model.commentIntegrity.length ? htmlSection(FEEDBACK_SHEET_LABELS.commentIntegrity, `<ul>${model.commentIntegrity.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`, 'safety') : ''}${model.commentError ? htmlSection(FEEDBACK_SHEET_LABELS.commentError, `<p class="pre">${escapeHtml(FEEDBACK_SHEET_LABELS.commentErrorBody)} ${escapeHtml(model.commentError)}</p>`, 'safety') : ''}${htmlSection(FEEDBACK_SHEET_LABELS.strengths, htmlList(model.strengths))}${htmlSection(FEEDBACK_SHEET_LABELS.improvements, htmlList(model.improvements), 'improvements')}</article>`;
}

export const feedbackSheetStyles = `@page{size:Letter;margin:.45in}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111827;background:#fff;margin:0;font-size:10pt;line-height:1.35}.sheet{max-width:7.6in;margin:0 auto}.sheet header{border-bottom:1px solid #9ca3af;padding-bottom:8pt}.kicker{color:#1d4ed8;font-size:8pt;font-weight:bold;letter-spacing:.06em;text-transform:uppercase}.sheet h1{font-size:20pt;line-height:1.1;margin:3pt 0}.sheet h2{font-size:11pt;margin:0 0 5pt}.sheet header p{margin:2pt 0}.sheet header small{color:#4b5563}.section{border:1px solid #d1d5db;border-radius:5px;padding:8pt;margin-top:8pt;break-inside:avoid}.section p{margin:4pt 0}.section ul{margin:4pt 0;padding-left:18pt}.missing{color:#6b7280}.pre{white-space:pre-wrap}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8pt}.score{position:relative}.total{position:absolute;right:8pt;top:8pt;color:#1d4ed8;font-size:13pt}.row{margin-top:7pt}.row p{font-size:9pt}.safety{border-color:#f59e0b}.improvements{background:#fffbeb;border-color:#f59e0b}@media print{.section{box-shadow:none}}`;
