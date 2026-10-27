import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim()).map((item) => item.trim()).filter((item) => !/reveal this goal only in post-case feedback|do not disclose the target diagnosis|do not reveal .*goal/i.test(item)) : [];
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : 'Not recorded.';

export default function AssignmentDebrief() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { user } = useAuthStore();
  const [assignment, setAssignment] = useState<any>(null);
  useEffect(() => { if (!assignmentId || !user) return; void supabase.from('student_room_assignments').select('*, room:room_id(room_number, expected_diagnosis)').eq('id', assignmentId).single().then(({ data }) => { if (data?.student_id === user.id) setAssignment(data); }); }, [assignmentId, user]);
  if (!assignment) return <main className="mx-auto max-w-5xl p-8">Loading feedback…</main>;
  const debrief = assignment.feedback_debrief ?? {};
  const communication = assignment.communication_breakdown ?? {};
  const reasoning = assignment.clinical_reasoning_breakdown ?? assignment.mdm_breakdown ?? {};
  const goals = list(debrief.case_goals ?? debrief.goals ?? assignment.room?.case_goals);
  const strengths = list(debrief.strengths);
  const improvements = list(debrief.improvements ?? debrief.areas_for_improvement);
  const card = (title: string, score: unknown, rows: any) => <section className="rounded-lg border bg-white p-5 shadow-sm"><div className="flex items-baseline justify-between"><h2 className="font-semibold">{title}</h2><strong className="text-3xl text-blue-700">{typeof score === 'number' ? `${score}/5` : '—'}</strong></div>{Object.entries(rows).map(([label, item]: any) => <div className="mt-4" key={label}><div className="flex justify-between text-sm font-medium"><span>{label}</span><span>{item?.score ?? 'Not observed'}</span></div><p className="mt-1 text-sm text-gray-600">{text(item?.feedback)}</p></div>)}</section>;
  return <main className="min-h-screen bg-gray-50 p-6"><div className="mx-auto max-w-5xl space-y-6"><header><p className="text-sm font-medium text-blue-700">Formative debrief</p><h1 className="mt-1 text-3xl font-bold">Review your feedback</h1><p className="text-sm text-gray-600">Room {assignment.room?.room_number || '—'}</p></header><section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Case goals</h2>{goals.length ? <ul className="mt-2 list-disc pl-5 text-sm">{goals.map((goal) => <li key={goal}>{goal}</li>)}</ul> : <p className="mt-2 text-sm text-gray-500">No case goals were recorded.</p>}</section><div className="grid gap-6 md:grid-cols-2">{card('Communication', assignment.communication_score, { 'Focused Information Gathering (0–2)': communication.focused_information_gathering, 'Closed-Loop Team Communication (0–3)': communication.closed_loop_team_communication, 'Efficiency Deduction (−2–0)': communication.efficiency_deduction })}{card('Clinical Reasoning', assignment.clinical_reasoning_score ?? assignment.mdm_score, { 'Orders/Monitoring Quality (0–3)': reasoning.orders_monitoring_quality, 'Clinical Reasoning/Documentation (0–2)': reasoning.clinical_reasoning_documentation, 'Safety Deduction (0, −1, −2)': reasoning.safety_deduction })}</div><details className="rounded-lg border bg-white p-5 shadow-sm"><summary className="cursor-pointer font-semibold">Observed actions and orders</summary><p className="mt-3 whitespace-pre-wrap text-sm">{text(debrief.action_review?.summary)}</p></details>{strengths.length > 0 && <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Specific strengths</h2><ul className="mt-2 list-disc pl-5 text-sm">{strengths.map((item) => <li key={item}>{item}</li>)}</ul></section>}{improvements.length > 0 && <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm"><h2 className="font-semibold text-amber-950">Actionable improvements</h2><ul className="mt-2 list-disc pl-5 text-sm text-amber-950">{improvements.map((item) => <li key={item}>{item}</li>)}</ul></section>}<button type="button" onClick={() => window.print()} className="rounded border bg-white px-3 py-2 text-sm">Print feedback / Open print-ready view</button></div></main>;
}
