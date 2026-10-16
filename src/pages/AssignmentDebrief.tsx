import { useEffect, useState } from 'react';
import { ArrowLeft, Printer, ShieldAlert } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { feedbackDomainArithmetic, parseCanonicalFeedback, type CanonicalFeedback } from '../lib/feedbackContract';
import { buildAttemptEvidence, evidenceQueryErrorMessage, type AttemptEvidence } from '../lib/attemptEvidence';

const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const clean = (value: unknown) => typeof value === 'string' ? value.replace(/message count and timing are not scored/gi, 'No case-specific efficiency deduction was observed.').replace(/review the evidence-linked strengths and next steps below\.?/gi, '').replace(/\s+/g, ' ').trim() : '';
const goalsOnly = (value: unknown): string[] => Array.from(new Set(asArray<unknown>(value).flatMap((item) => clean(item).split(/\r?\n/)).map((item) => item.replace(/^[-*•]\s*/, '').trim()).filter((item) => item.length >= 8 && item.length <= 220 && !/reveal this goal|do not disclose|after the simulation|target diagnosis\s*[—:-]/i.test(item)))).slice(0, 5);
const text = (...values: unknown[]) => clean(values.find((value) => typeof value === 'string' && value.trim()));
export const PRINT_COMPONENT_FEEDBACK_LIMIT = 160;
export const PRINT_EVENT_BODY_LIMIT = 140;
export const PRINT_SAFETY_TEXT_LIMIT = 180;
export const compactPrintText = (value: unknown, fallback: string, limit = PRINT_EVENT_BODY_LIMIT) => {
  const normalized = text(value) || fallback;
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}…` : normalized;
};
export const conciseEfficiencyRationale = (value: unknown, score = 0) => {
  const normalized = clean(value).replace(/no case-specific efficiency deduction(?: was observed)?[.;:]?\s*/gi, '').trim();
  return normalized && !/^[\s\W_]+$/.test(normalized)
    ? normalized
    : score < 0 ? 'Unnecessary or repetitive communication was observed.' : 'No case-specific efficiency deduction.';
};
const efficiencyFeedback = (value: unknown) => conciseEfficiencyRationale(value);
export { efficiencyFeedback };
export const removeDiagnosisGoal = (goal: string, diagnosis: string | null) => {
  const normalizedGoal = goal.trim().replace(/[.!?]+$/, '').toLowerCase();
  const normalizedDiagnosis = diagnosis?.trim().replace(/[.!?]+$/, '').toLowerCase();
  return normalizedDiagnosis && (normalizedGoal === normalizedDiagnosis || normalizedGoal === `recognize ${normalizedDiagnosis}`) ? null : goal;
};

const numericScore = (component: any) => typeof component?.score === 'number' && Number.isFinite(component.score) ? component.score : null;
const resolvedTotal = (components: Array<{ score?: number | null }>, legacy: unknown) => {
  const scores = components.map((component) => component.score);
  if (scores.every((score): score is number => typeof score === 'number' && Number.isFinite(score))) {
    return Math.max(0, Math.min(5, scores.reduce((sum, score) => sum + score, 0)));
  }
  return typeof legacy === 'number' && Number.isFinite(legacy) ? Math.max(0, Math.min(5, legacy)) : null;
};
export const resolveCanonicalTotals = (assignment: any, comm: any, reasoning: any) => ({
  communication: resolvedTotal([
    { score: numericScore(comm?.focused_information_gathering) },
    { score: numericScore(comm?.closed_loop_team_communication) },
    { score: numericScore(comm?.efficiency_deduction) },
  ], assignment?.communication_score),
  clinicalReasoning: resolvedTotal([
    { score: numericScore(reasoning?.orders_monitoring_quality) },
    { score: numericScore(reasoning?.clinical_reasoning_documentation) },
    { score: numericScore(reasoning?.safety_deduction) },
  ], assignment?.clinical_reasoning_score ?? assignment?.mdm_score),
});

const ScoreCard = ({ label, total, components }: { label: string; total: number | null; components: Array<{ label: string; score?: number; feedback?: string }> }) => {
  const arithmetic = feedbackDomainArithmetic(Object.fromEntries(components.map((component) => [component.label, { score: component.score ?? 0, min: 0, max: 5, feedback: '', evidence_event_ids: [] }])));
  return <section className="rounded-lg border bg-white p-5 shadow-sm"><div className="flex items-baseline justify-between"><h2 className="font-semibold">{label}</h2><strong className="text-3xl text-blue-700">{typeof total === 'number' ? `${total}/5` : '—'}</strong></div><p className="mt-1 text-xs text-slate-500">Arithmetic: {arithmetic.raw} → capped total {arithmetic.total}/5</p><div className="mt-4 space-y-3">{components.map((component) => <div key={component.label}><div className="flex justify-between text-sm font-medium"><span>{component.label}</span><span>{typeof component.score === 'number' ? component.score : 'Not observed'}</span></div><p className="mt-1 text-sm text-slate-600">{component.label.startsWith('Efficiency') ? efficiencyFeedback(component.feedback) : text(component.feedback) || 'Insufficient evidence.'}</p></div>)}</div></section>;
};

const PrintSummary = ({ assignment, diagnosis, goals, comm, reasoning, strengths, nextSteps, evidence, totals, safetyResult }: any) => {
  const components = [
    ['Focused information (0–2)', comm.focused_information_gathering],
    ['Closed-loop communication (0–3)', comm.closed_loop_team_communication],
    ['Efficiency deduction (−2–0)', comm.efficiency_deduction],
    ['Orders/monitoring (0–3)', reasoning.orders_monitoring_quality],
    ['Reasoning/documentation (0–2)', reasoning.clinical_reasoning_documentation],
    ['Safety deduction (0, −1, −2)', reasoning.safety_deduction],
  ] as const;
  return <article className="print-sheet" aria-label="Printable formative feedback">
    <header><p className="print-kicker">Formative feedback</p><h1>{assignment.feedback_debrief?.canonical_feedback?.room_label ?? `Room ${assignment.room?.room_number ?? ''}`}</h1>{diagnosis && <p><b>Target diagnosis:</b> {diagnosis}</p>}</header>
    <section><h2>Case goals</h2>{goals.length ? <ul>{goals.slice(0, 4).map((goal: string) => <li key={goal}>{goal}</li>)}</ul> : <p>No case-specific goals recorded.</p>}</section>
    <div className="print-score-grid"><section><h2>Communication <strong>{totals.communication ?? '—'}/5</strong></h2>{components.slice(0, 3).map(([label, component]) => <p key={label}><b>{label}:</b> {component?.score ?? 'Not observed'} — <span className="print-component-feedback">{label.startsWith('Efficiency') ? compactPrintText(efficiencyFeedback(component?.feedback), 'No case-specific efficiency deduction.', PRINT_COMPONENT_FEEDBACK_LIMIT) : compactPrintText(component?.feedback, 'Insufficient evidence.', PRINT_COMPONENT_FEEDBACK_LIMIT)}</span></p>)}</section><section><h2>Clinical reasoning <strong>{totals.clinicalReasoning ?? '—'}/5</strong></h2>{components.slice(3).map(([label, component]) => <p key={label}><b>{label}:</b> {component?.score ?? 'Not observed'} — <span className="print-component-feedback">{compactPrintText(component?.feedback, 'Insufficient evidence.', PRINT_COMPONENT_FEEDBACK_LIMIT)}</span></p>)}</section></div>
    {safetyResult?.level && safetyResult.level !== 'none' && <section className="print-safety"><h2>Safety result: {safetyResult.level}</h2><p className="print-safety-text">{compactPrintText(safetyResult.rationale || safetyResult.action, 'Safety concern observed.', PRINT_SAFETY_TEXT_LIMIT)}</p></section>}
    {strengths.length > 0 && <section><h2>Strengths</h2><ul>{strengths.slice(0, 2).map((item: string) => <li key={item}>{compactPrintText(item, 'Strength observed.', PRINT_COMPONENT_FEEDBACK_LIMIT)}</li>)}</ul></section>}
    {nextSteps.length > 0 && <section><h2>Next steps</h2><ul>{nextSteps.slice(0, 2).map((item: string) => <li key={item}>{compactPrintText(item, 'Next step.', PRINT_COMPONENT_FEEDBACK_LIMIT)}</li>)}</ul></section>}
    {evidence.length > 0 && <section><h2>Attempt evidence</h2>{evidence.slice(0, 3).map((event: AttemptEvidence) => <p key={event.id}><b>{compactPrintText(event.title, event.kind, PRINT_EVENT_BODY_LIMIT)}:</b> <span className="print-event-body">{compactPrintText(event.body, event.kind, PRINT_EVENT_BODY_LIMIT)}</span></p>)}</section>}
  </article>;
};

export default function AssignmentDebrief() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<any>(null);
  const [sourceEvidence, setSourceEvidence] = useState<AttemptEvidence[]>([]);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { if (!user || !assignmentId) return; void (async () => {
    const { data, error } = await supabase.from('student_room_assignments').select('*, room:room_id(room_number, patient_id, expected_diagnosis, case_goals)').eq('id', assignmentId).single();
    if (error || !data || data.student_id !== user.id) { navigate('/assignments'); setLoading(false); return; }
    setAssignment(data);
    const [chatResult, patientChatResult, orderResult, labResult, imagingResult, vitalsResult, consultantResult] = await Promise.all([
      supabase.from('chat_messages').select('id, role, content, created_at').eq('assignment_id', assignmentId).order('created_at', { ascending: true }),
      supabase.from('patient_chat_messages').select('id, role, content, created_at').eq('assignment_id', assignmentId).order('created_at', { ascending: true }),
      data.room?.patient_id ? supabase.from('medical_orders').select('id, order_name, status, priority, frequency, created_at, order_time').eq('assignment_id', assignmentId).eq('patient_id', data.room.patient_id).is('deleted_at', null).order('created_at', { ascending: true }) : Promise.resolve({ data: [], error: null }),
      data.room?.patient_id ? supabase.from('lab_results').select('id, test_name, value, unit, status, created_at, result_time, collection_time').eq('assignment_id', assignmentId).eq('patient_id', data.room.patient_id).is('deleted_at', null).order('created_at', { ascending: true }) : Promise.resolve({ data: [], error: null }),
      data.room?.patient_id ? supabase.from('imaging_studies').select('id, order_name, study_type, status, report, created_at, report_generated_at, order_time').eq('assignment_id', assignmentId).eq('patient_id', data.room.patient_id).is('deleted_at', null).order('created_at', { ascending: true }) : Promise.resolve({ data: [], error: null }),
      data.room?.patient_id ? supabase.from('vital_signs').select('id, timestamp, temperature, heart_rate, respiratory_rate, oxygen_saturation, blood_pressure_systolic, blood_pressure_diastolic').eq('assignment_id', assignmentId).eq('patient_id', data.room.patient_id).order('timestamp', { ascending: true }) : Promise.resolve({ data: [], error: null }),
      supabase.from('consultant_chat_messages').select('id, role, content, created_at, specialty, urgency').eq('assignment_id', assignmentId).order('created_at', { ascending: true }),
    ]);
    const queryError = evidenceQueryErrorMessage([
      { label: 'chat', error: chatResult.error },
      { label: 'patient chat', error: patientChatResult.error },
      { label: 'orders', error: orderResult.error },
      { label: 'labs', error: labResult.error },
      { label: 'imaging', error: imagingResult.error },
      { label: 'vitals', error: vitalsResult.error },
      { label: 'consultant messages', error: consultantResult.error },
    ]);
    setEvidenceError(queryError);
    const chat = [...(chatResult.data ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const firstPage = chat.find((row) => ['assistant', 'nurse'].includes(row.role) && row.content !== '<completed>');
    const boundary = firstPage ? new Date(firstPage.created_at).getTime() : Number.POSITIVE_INFINITY;
    setSourceEvidence(buildAttemptEvidence({
      chat,
      patientChat: patientChatResult.data ?? [],
      orders: orderResult.data ?? [],
      labs: labResult.data ?? [],
      imaging: imagingResult.data ?? [],
      vitals: vitalsResult.data ?? [],
      progressNote: data.student_progress_note,
      completedAt: data.completed_at,
      boundary,
    }));
    setLoading(false);
  })(); }, [assignmentId, user, navigate]);
  if (loading) return <><Navbar /><main className="mx-auto max-w-4xl p-8">Loading feedback…</main></>;
  if (!assignment) return null;
  const debrief = assignment.feedback_debrief ?? {};
  const canonical: CanonicalFeedback | null = parseCanonicalFeedback(debrief.canonical_feedback);
  const comm = canonical?.communication.components ?? assignment.communication_breakdown ?? {};
  const reasoning = canonical?.clinical_reasoning.components ?? assignment.clinical_reasoning_breakdown ?? assignment.mdm_breakdown ?? {};
  const diagnosis = canonical?.target_diagnosis ?? assignment.room?.expected_diagnosis ?? null;
  const goals = (canonical?.goals ?? goalsOnly(debrief.case_goals ?? assignment.room?.case_goals)).map((goal) => removeDiagnosisGoal(goal, diagnosis)).filter((goal): goal is string => Boolean(goal));
  const strengths = canonical?.strengths ?? goalsOnly(debrief.strengths);
  const nextSteps = canonical?.next_steps ?? goalsOnly(debrief.improvements ?? debrief.recommendations);
  const evidence = Array.from(new Map([...(canonical?.evidence ?? []), ...sourceEvidence].map((event) => [event.id, event])).values());
  const totals = resolveCanonicalTotals(assignment, comm, reasoning);
  return <div className="min-h-screen bg-gray-50"><Navbar /><main id="feedback-print-root" className="mx-auto max-w-5xl space-y-6 p-6">
    <div className="flex items-center justify-between"><button onClick={() => navigate(`/assignment/${assignmentId}`)} className="inline-flex items-center text-sm text-gray-600"><ArrowLeft className="mr-2 h-4 w-4" />Back to completed case</button><button onClick={() => window.print()} className="inline-flex items-center rounded border bg-white px-3 py-2 text-sm"><Printer className="mr-2 h-4 w-4" />Print feedback</button></div>
    <header><p className="text-sm font-medium text-blue-700">Formative debrief</p><h1 className="mt-1 text-3xl font-bold text-gray-900">{canonical?.room_label ?? `Room ${assignment.room?.room_number ?? ''}`}</h1>{diagnosis && <p className="mt-1 text-sm font-medium text-gray-700">Target diagnosis: {diagnosis}</p>}</header>
    {assignment.technical_incomplete && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">This attempt is technically incomplete because the first nurse page was not recorded. No learner score was assigned.</div>}
    <section className="feedback-screen rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Case goals</h2>{goals.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">{goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>}</section>
    <div className="feedback-screen grid gap-6 md:grid-cols-2"><ScoreCard label="Communication" total={totals.communication} components={[{ label: 'Focused Information Gathering (0–2)', ...comm.focused_information_gathering }, { label: 'Closed-Loop Team Communication (0–3)', ...comm.closed_loop_team_communication }, { label: 'Efficiency Deduction (−2–0)', ...comm.efficiency_deduction }]} /><ScoreCard label="Clinical Reasoning" total={totals.clinicalReasoning} components={[{ label: 'Orders/Monitoring Quality (0–3)', ...reasoning.orders_monitoring_quality }, { label: 'Clinical Reasoning/Documentation (0–2)', ...reasoning.clinical_reasoning_documentation }, { label: 'Safety Deduction (0, −1, −2)', ...reasoning.safety_deduction }]} /></div>
    {evidenceError && <div role="alert" className="feedback-screen rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">{evidenceError}</div>}
    <details className="feedback-screen rounded-lg border bg-white p-5 shadow-sm" open><summary className="cursor-pointer font-semibold">Observed attempt evidence</summary><div className="mt-3 space-y-3 text-sm">{evidence.length ? evidence.map((event) => <div key={event.id} className="border-l-2 border-blue-200 pl-3"><p className="font-medium">{event.title}</p><p className="text-xs text-slate-500">{event.kind} · {new Date(event.timestamp).toLocaleString()}</p>{event.body && <p className="mt-1 text-slate-600">{event.body}</p>}</div>) : evidenceError ? <p className="text-slate-600">Evidence could not be loaded.</p> : <p className="text-slate-600">No attempt-scoped evidence recorded.</p>}</div></details>
    <div className="feedback-screen">{assignment.safety_result?.level && assignment.safety_result.level !== 'none' && <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="flex items-center font-semibold"><ShieldAlert className="mr-2 h-5 w-5 text-amber-600" />Safety result</h2><p className="mt-2 text-sm">{assignment.safety_result.rationale || assignment.safety_result.action}</p></section>}{strengths.length > 0 && <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Evidence-linked strengths</h2><ul className="mt-2 list-disc pl-5 text-sm">{strengths.map((item) => <li key={item}>{item}</li>)}</ul></section>}{nextSteps.length > 0 && <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm"><h2 className="font-semibold text-amber-950">Next steps</h2><ul className="mt-2 list-disc pl-5 text-sm text-amber-950">{nextSteps.map((item) => <li key={item}>{item}</li>)}</ul></section>}</div>
    <PrintSummary assignment={assignment} diagnosis={diagnosis} goals={goals} comm={comm} reasoning={reasoning} strengths={strengths} nextSteps={nextSteps} evidence={evidence} totals={totals} safetyResult={assignment.safety_result} />
  </main></div>;
}
