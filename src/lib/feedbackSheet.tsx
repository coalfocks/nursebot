import React from 'react';

type AnyRecord = Record<string, unknown>;

export type FeedbackSheetAssignment = AnyRecord & {
  room?: { room_number?: string | null } | null;
};

export type FeedbackSheetModel = {
  studentName: string;
  roomNumber: string;
  generatedAt: string | null;
  version: string | null;
  goals: string[];
  summary: string | null;
  communicationScore: number | null;
  communication: Array<{ label: string; score: string; feedback: string }>;
  clinicalReasoningScore: number | null;
  clinicalReasoning: Array<{ label: string; score: string; feedback: string }>;
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

const list = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim()).map((item) => item.trim());
  const one = text(value);
  return one ? [one] : [];
};

const cleanReaderList = (...values: unknown[]): string[] => {
  const blocked = /reveal this goal only in post-case feedback|do not disclose the target diagnosis|do not reveal .*goal|review the evidence-linked strengths|you are evaluating|after the simulation, you should be able to|goals of (?:this )?case|target diagnosis\s*[—:-]/i;
  const output: string[] = [];
  for (const value of values) {
    for (const item of list(value)) {
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

const firstList = (...values: unknown[]): string[] => {
  for (const value of values) {
    const result = list(value);
    if (result.length) return result;
  }
  return [];
};

const score = (value: unknown): string => typeof value === 'number' ? String(value) : 'Not recorded';

const breakdownItem = (source: AnyRecord, ...keys: string[]) => {
  const item = record(keys.map((key) => source[key]).find((value) => value !== undefined));
  return { score: score(item.score), feedback: text(item.feedback) || 'Not recorded.' };
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

  return {
    studentName: text(assignment.student_name, record(assignment.student).full_name) || 'Student',
    roomNumber: text(assignment.room_number, assignment.room && assignment.room.room_number) || '—',
    generatedAt: text(assignment.feedback_generated_at) || null,
    version: text(assignment.feedback_version, assignment.feedback_schema_version, debrief.version, debrief.schema_version) || null,
    goals: cleanReaderList(debrief.case_goals, debrief.goals, assignment.goals, record(assignment.room).case_goals),
    summary: null,
    communicationScore: typeof assignment.communication_score === 'number' ? assignment.communication_score : null,
    communication: communication.map((item, index) => ({
      ...item,
      score: item.score === 'Not recorded' && index < 2 ? breakdownItem(legacyCommunication, index === 0 ? 'information_sharing' : 'responsive_communication').score : item.score,
      feedback: item.feedback === 'Not recorded.' && index < 2 ? text(legacyCommunication.comments) || item.feedback : item.feedback,
    })),
    clinicalReasoningScore: typeof (assignment.clinical_reasoning_score ?? assignment.mdm_score) === 'number' ? (assignment.clinical_reasoning_score ?? assignment.mdm_score) as number : null,
    clinicalReasoning: clinicalReasoning.map((item) => ({
      ...item,
      feedback: item.feedback === 'Not recorded.' ? text(legacyClinical.comments) || item.feedback : item.feedback,
    })),
    safety: text(safetyResult.level, safetyResult.result) ? {
      level: text(safetyResult.level, safetyResult.result),
      detail: text(safetyResult.rationale, safetyResult.action, safetyResult.feedback) || 'No further safety detail was recorded.',
    } : typeof savedSafetyDeduction.score === 'number' || typeof savedSafetyDeduction.feedback === 'string' && savedSafetyDeduction.feedback.trim() ? {
      level: `Safety deduction: ${typeof savedSafetyDeduction.score === 'number' ? savedSafetyDeduction.score : 'Not recorded'}`,
      detail: text(savedSafetyDeduction.feedback) || 'No further safety detail was recorded.',
    } : null,
    actions: actionValues.map((item) => {
      const action = record(item);
      return { label: text(action.label, action.action, action.order, 'Observed action/order'), detail: text(action.assessment, action.explanation, action.status, action.feedback) || 'No review detail was recorded.' };
    }),
    strengths: firstList(debrief.strengths, assignment.strengths, legacyClinical.strengths, legacyCommunication.strengths),
    improvements: cleanReaderList(debrief.improvements, debrief.areas_for_improvement, assignment.improvements, legacyClinical.areas_for_improvement, legacyCommunication.areas_for_improvement),
  };
}

export function FeedbackSheet({ model, className = '' }: { model: FeedbackSheetModel; className?: string }) {
  const listSection = (title: string, values: string[], tone = '') => (
    <section className={`rounded-lg border p-4 ${tone}`}><h2 className="font-semibold text-gray-900">{title}</h2>{values.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">{values.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-gray-500">Not recorded.</p>}</section>
  );
  return <article className={`feedback-sheet space-y-4 bg-white text-gray-900 ${className}`}>
    <header className="border-b border-gray-300 pb-3"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Formative feedback · attempt-specific debrief</p><h1 className="mt-1 text-2xl font-bold">Review feedback</h1><p className="mt-1 text-sm text-gray-600">{model.studentName} · Room {model.roomNumber}</p><p className="text-xs text-gray-500">Recorded {model.generatedAt ? new Date(model.generatedAt).toLocaleString() : 'date not recorded'}{model.version ? ` · Version ${model.version}` : ''}</p></header>
    {listSection('Case goals', model.goals)}
    <div className="grid gap-4 md:grid-cols-2">{[['Communication', model.communicationScore, model.communication], ['Clinical reasoning', model.clinicalReasoningScore, model.clinicalReasoning]].map(([title, total, rows]) => <section key={title as string} className="rounded-lg border p-4"><div className="flex items-baseline justify-between"><h2 className="font-semibold">{title as string}</h2><strong className="text-xl text-blue-700">{typeof total === 'number' ? `${total}/5` : 'Not recorded'}</strong></div><div className="mt-3 space-y-3">{(rows as FeedbackSheetModel['communication']).map((item) => <div key={item.label}><p className="text-sm font-medium">{item.label}: {item.score}</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{item.feedback}</p></div>)}</div></section>)}</div>
    {model.safety && <section className="rounded-lg border p-4"><h2 className="font-semibold">Separate safety result</h2><p className="mt-2 text-sm font-medium">{model.safety.level}</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{model.safety.detail}</p></section>}
    <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-semibold">Observed actions and orders</summary>{model.actions.length ? <div className="mt-3 space-y-3 text-sm">{model.actions.map((item, index) => <div key={`${item.label}-${index}`} className="border-l-2 border-blue-200 pl-3"><p className="font-medium">{item.label}</p><p className="mt-1 whitespace-pre-wrap text-gray-600">{item.detail}</p></div>)}</div> : <p className="mt-3 text-sm text-gray-500">Not recorded.</p>}</details>
    {listSection('Specific strengths', model.strengths)}
    {listSection('Actionable improvements', model.improvements, 'border-amber-200 bg-amber-50')}
  </article>;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
const htmlList = (values: string[]) => values.length ? `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="missing">Not recorded.</p>';
const htmlSection = (title: string, content: string, className = '') => `<section class="section ${className}"><h2>${escapeHtml(title)}</h2>${content}</section>`;

export function renderFeedbackSheetHtml(model: FeedbackSheetModel): string {
  const scoreSection = (title: string, total: number | null, rows: FeedbackSheetModel['communication']) => htmlSection(title, `<strong class="total">${total === null ? 'Not recorded' : `${total}/5`}</strong>${rows.map((item) => `<div class="row"><b>${escapeHtml(item.label)}: ${escapeHtml(item.score)}</b><p>${escapeHtml(item.feedback)}</p></div>`).join('')}`, 'score');
  return `<article class="sheet"><header><p class="kicker">Formative feedback · attempt-specific debrief</p><h1>Review your feedback</h1><p>${escapeHtml(model.studentName)} · Room ${escapeHtml(model.roomNumber)}</p><small>Recorded ${escapeHtml(model.generatedAt ? new Date(model.generatedAt).toLocaleString() : 'date not recorded')}${model.version ? ` · Version ${escapeHtml(model.version)}` : ''}</small></header>${htmlSection('Case goals', htmlList(model.goals))}<div class="grid">${scoreSection('Communication', model.communicationScore, model.communication)}${scoreSection('Clinical Reasoning', model.clinicalReasoningScore, model.clinicalReasoning)}</div>${model.safety ? htmlSection('Separate safety result', `<b>${escapeHtml(model.safety.level)}</b><p class="pre">${escapeHtml(model.safety.detail)}</p>`, 'safety') : ''}${htmlSection('Observed actions and orders', model.actions.length ? model.actions.map((item) => `<div class="row"><b>${escapeHtml(item.label)}</b><p class="pre">${escapeHtml(item.detail)}</p></div>`).join('') : '<p class="missing">Not recorded.</p>')}${htmlSection('Specific strengths', htmlList(model.strengths))}${htmlSection('Actionable improvements', htmlList(model.improvements), 'improvements')}</article>`;
}

export const feedbackSheetStyles = `@page{size:Letter;margin:.45in}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111827;background:#fff;margin:0;font-size:10pt;line-height:1.35}.sheet{max-width:7.6in;margin:0 auto}.sheet header{border-bottom:1px solid #9ca3af;padding-bottom:8pt}.kicker{color:#1d4ed8;font-size:8pt;font-weight:bold;letter-spacing:.06em;text-transform:uppercase}.sheet h1{font-size:20pt;line-height:1.1;margin:3pt 0}.sheet h2{font-size:11pt;margin:0 0 5pt}.sheet header p{margin:2pt 0}.sheet header small{color:#4b5563}.section{border:1px solid #d1d5db;border-radius:5px;padding:8pt;margin-top:8pt;break-inside:avoid}.section p{margin:4pt 0}.section ul{margin:4pt 0;padding-left:18pt}.missing{color:#6b7280}.pre{white-space:pre-wrap}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8pt}.score{position:relative}.total{position:absolute;right:8pt;top:8pt;color:#1d4ed8;font-size:13pt}.row{margin-top:7pt}.row p{font-size:9pt}.safety{border-color:#f59e0b}.improvements{background:#fffbeb;border-color:#f59e0b}@media print{.section{box-shadow:none}}`;
