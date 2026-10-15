import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, ShieldAlert } from 'lucide-react';
import Navbar from '../components/Navbar';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

const scoreCard = (label: string, score: unknown, breakdown: Array<{ label: string; value: unknown; feedback: unknown }>) => (
  <section className="rounded-lg border bg-white p-5 shadow-sm" aria-labelledby={`${label}-heading`}>
    <div className="flex items-baseline justify-between"><h2 id={`${label}-heading`} className="font-semibold text-gray-900">{label}</h2><span className="text-3xl font-bold text-blue-700">{typeof score === 'number' ? `${score}/5` : '—'}</span></div>
    <div className="mt-4 space-y-3">{breakdown.map((item) => <div key={item.label}><div className="flex justify-between text-sm font-medium"><span>{item.label}</span><span>{typeof item.value === 'number' ? `${item.value}` : 'Not observed'}</span></div><p className="mt-1 text-sm text-gray-600">{String(item.feedback || 'Insufficient evidence.')}</p></div>)}</div>
  </section>
);

type GrowthArea = {
  title?: string;
  case_goal?: string;
  practice_example?: string;
  example?: string;
  evidence?: Array<{ event_id?: string; id?: string; label?: string; occurred_at?: string }>;
};

export default function AssignmentDebrief() {
  const { assignmentId } = useParams<{ assignmentId: string }>(); const { user } = useAuthStore(); const navigate = useNavigate();
  const [assignment, setAssignment] = useState<any>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { if (!user || !assignmentId) return; supabase.from('student_room_assignments').select('*').eq('id', assignmentId).single().then(({ data, error }) => { if (error || !data || data.student_id !== user.id) navigate('/assignments'); else setAssignment(data); setLoading(false); }); }, [assignmentId, user, navigate]);
  if (loading) return <><Navbar /><main className="mx-auto max-w-4xl p-8">Loading feedback…</main></>;
  if (!assignment) return null;
  const debrief = assignment.feedback_debrief ?? {}; const comm = assignment.communication_breakdown ?? {}; const mdm = assignment.mdm_breakdown ?? {};
  const growthAreas: GrowthArea[] = Array.isArray(debrief.growth_areas) && debrief.growth_areas.length ? debrief.growth_areas : [{
    title: 'Growth area: close the loop after urgent monitoring',
    practice_example: debrief.recommendations?.[0] || debrief.improvements?.[0] || 'After urgent monitoring, state when you will repeat vital signs and reassess perfusion, then document the result and communicate whether the plan changed.',
    case_goal: debrief.case_goals?.find((goal: string) => /monitor|reassess|escalat/i.test(goal)) || debrief.case_goals?.[0] || 'Link actions to the case goals and observable reassessment.',
    evidence: [],
  }];
  const handlePrint = () => {
    const previousTitle = document.title;
    document.title = 'Formative feedback';
    window.requestAnimationFrame(() => {
      window.print();
      window.setTimeout(() => { document.title = previousTitle; }, 1000);
    });
  };
  return <div className="min-h-screen bg-gray-50"><Navbar /><main id="feedback-print-root" className="mx-auto max-w-5xl space-y-6 p-6 print:p-0">
    <div className="flex items-center justify-between print:hidden"><button onClick={() => navigate(`/assignment/${assignmentId}`)} className="inline-flex items-center text-sm text-gray-600"><ArrowLeft className="mr-2 h-4 w-4" />Back to completed case</button><button type="button" aria-label="Print feedback" onClick={handlePrint} className="inline-flex items-center rounded border bg-white px-3 py-2 text-sm"><Printer className="mr-2 h-4 w-4" />Print feedback</button></div>
    <header><p className="text-sm font-medium text-blue-700">Formative debrief</p><h1 className="mt-1 text-3xl font-bold text-gray-900">Review your feedback</h1><p className="mt-2 text-sm text-gray-600">{debrief.formative_notice || 'Formative feedback for learning only; not an ACGME Milestone, EPA entrustment decision, or validated competence determination.'}</p></header>
    {assignment.technical_incomplete && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">This attempt is technically incomplete because the first nurse page was not recorded. No learner score was assigned.</div>}
    <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Case goals and your approach</h2><ul className="mt-2 list-disc pl-5 text-sm text-gray-700">{(debrief.case_goals ?? []).map((goal: string) => <li key={goal}>{goal}</li>)}</ul><p className="mt-3 text-sm text-gray-700">{debrief.approach_summary || assignment.learning_objectives || 'No approach summary available.'}</p>{assignment.scoring_start_at && <p className="mt-3 text-xs text-gray-500">Scoring begins with the first nurse page at {new Date(assignment.scoring_start_at).toLocaleString()}.</p>}</section>
    <div className="grid gap-6 md:grid-cols-2">{scoreCard('Communication', assignment.communication_score, [{ label: 'Focused Information Gathering (0–2)', value: comm.focused_information_gathering?.score, feedback: comm.focused_information_gathering?.feedback }, { label: 'Closed-Loop Team Communication (0–3)', value: comm.closed_loop_team_communication?.score, feedback: comm.closed_loop_team_communication?.feedback }])}{scoreCard('Medical Decision Making', assignment.mdm_score, [{ label: 'Orders/Monitoring Quality (0–3)', value: mdm.orders_monitoring_quality?.score, feedback: mdm.orders_monitoring_quality?.feedback }, { label: 'Clinical Reasoning/Documentation (0–2)', value: mdm.clinical_reasoning_documentation?.score, feedback: mdm.clinical_reasoning_documentation?.feedback }])}</div>
    <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="flex items-center font-semibold"><ShieldAlert className="mr-2 h-5 w-5 text-amber-600" />Separate safety result</h2><p className="mt-2 text-sm font-medium">{assignment.safety_result?.level ?? 'none'}</p><p className="mt-1 text-sm text-gray-700">{assignment.safety_result?.rationale || 'No safety concern observed.'}</p></section>
    <section className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Action and order review</h2>{debrief.action_review?.expected_pathway && <div className="mt-3 rounded bg-blue-50 p-3 text-sm text-blue-950"><p className="font-medium">Expected pathway for this case</p><p className="mt-1">{debrief.action_review.expected_pathway.expected_endpoint || 'Follow the case goals and reassess toward the expected endpoint.'}</p>{debrief.action_review.expected_pathway.must?.length > 0 && <p className="mt-1"><span className="font-medium">Must:</span> {debrief.action_review.expected_pathway.must.join('; ')}</p>}{debrief.action_review.expected_pathway.should?.length > 0 && <p className="mt-1"><span className="font-medium">Should:</span> {debrief.action_review.expected_pathway.should.join('; ')}</p>}{debrief.action_review.expected_pathway.acceptable_alternative_paths?.length > 0 && <p className="mt-1"><span className="font-medium">Acceptable alternatives:</span> {debrief.action_review.expected_pathway.acceptable_alternative_paths.join('; ')}</p>}</div>}<div className="mt-3 space-y-3">{(debrief.action_review?.items ?? debrief.action_review ?? []).length ? (debrief.action_review?.items ?? debrief.action_review).map((item: any, index: number) => <div key={index} className="border-l-2 border-blue-200 pl-3 text-sm"><p className="font-medium">{item.label || item.action || 'Action'}</p><p className="text-gray-600">{item.explanation || item.status || 'Evidence-linked review.'}</p></div>) : <p className="text-sm text-gray-600">No action review was recorded.</p>}</div></section>
    <section className="grid gap-6 md:grid-cols-2"><div className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Strengths</h2><ul className="mt-2 list-disc pl-5 text-sm">{(debrief.strengths ?? []).map((x: string) => <li key={x}>{x}</li>)}</ul></div><div className="rounded-lg border bg-white p-5 shadow-sm"><h2 className="font-semibold">Next-case learning goal</h2><p className="mt-2 text-sm">{debrief.recommendations?.[0] || debrief.improvements?.[0] || 'Continue linking actions to the case goals and observable reassessment.'}</p></div></section>
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm"><h2 className="font-semibold text-amber-950">Growth area and practice example</h2><div className="mt-3 space-y-4">{growthAreas.map((area, index) => <div key={`${area.title}-${index}`} className="border-l-2 border-amber-400 pl-3 text-sm text-amber-950"><p className="font-medium">{area.title || 'Next practice focus'}</p><p className="mt-1"><span className="font-medium">Case goal:</span> {area.case_goal || 'Link actions to the case goals.'}</p><p className="mt-1"><span className="font-medium">Practice example:</span> {area.practice_example || area.example || 'State when and what you will reassess, document the observed result, and communicate whether the plan changed.'}</p>{Array.isArray(area.evidence) && area.evidence.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs">{area.evidence.map((item) => <li key={item.event_id || item.id}>{item.label || 'Observed evidence'}{item.occurred_at ? ` — ${new Date(item.occurred_at).toLocaleString()}` : ''}</li>)}</ul>}</div>)}</div></section>
  </main></div>;
}
