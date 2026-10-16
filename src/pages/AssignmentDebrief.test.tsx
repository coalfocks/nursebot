import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock('../components/Navbar', () => ({ default: () => <nav /> }));
vi.mock('../stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'synthetic-student' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ assignmentId: 'synthetic-assignment' }) }));
vi.mock('../lib/supabase', () => ({ supabase: { from: fromMock } }));

const component = (score: number, min: number, max: number, feedback: string) => ({ score, min, max, feedback, evidence_event_ids: ['event-cbc', 'event-consult'] });
const assignment = {
  id: 'synthetic-assignment', student_id: 'synthetic-student', technical_incomplete: false,
  communication_score: 3, clinical_reasoning_score: 4, mdm_score: 4, scoring_start_at: '2026-10-16T00:00:00Z', learning_objectives: 'Document reassessment.',
  feedback_debrief: {
    canonical_feedback: {
      schema_version: 'feedback-contract-v1', room_label: 'Synthetic Room 112', target_diagnosis: 'Synthetic acute instability',
      goals: ['Name the diagnosis.', 'Prioritize monitoring and orders.'],
      communication: { total: 3, components: { focused_information_gathering: component(1, 0, 2, 'Collected focused information.'), closed_loop_team_communication: component(2, 0, 3, 'Closed the loop with the consultant.'), efficiency_deduction: component(0, -2, 0, 'No unnecessary repetition observed.') } },
      clinical_reasoning: { total: 4, components: { orders_monitoring_quality: component(2, 0, 3, 'Placed and completed the STAT CBC.'), clinical_reasoning_documentation: component(2, 0, 2, 'Documented the reassessment plan.'), safety_deduction: component(0, -2, 0, 'No unsafe learner order observed.') } },
      strengths: ['Focused escalation tied to the CBC result.'], next_steps: ['Document the reassessment result and plan change.'],
      evidence: [
        { id: 'event-cbc', kind: 'order', title: 'STAT CBC', body: 'Observed learner order and linked result.', timestamp: '2026-10-16T00:01:00Z' },
        { id: 'event-consult', kind: 'consultant-message', title: 'Consultant response', body: 'Persisted consultant response.', timestamp: '2026-10-16T00:02:00Z' },
      ], scoring_start_at: '2026-10-16T00:00:00Z',
    }, approach_summary: 'Focused escalation and documentation.', case_goals: [], strengths: [], action_review: {}, growth_areas: [],
  },
};

describe('AssignmentDebrief canonical rendered feedback', () => {
  it('renders case identity, goals, six components, evidence, strengths, and next steps without legacy placeholders', async () => {
    const query = { select: () => query, eq: () => query, single: () => Promise.resolve({ data: assignment, error: null }) };
    fromMock.mockReturnValue(query);
    const { default: AssignmentDebrief } = await import('./AssignmentDebrief');
    render(<AssignmentDebrief />);
    await waitFor(() => expect(screen.getAllByText('Synthetic Room 112').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Target diagnosis: Synthetic acute instability').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Name the diagnosis.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Prioritize monitoring and orders.').length).toBeGreaterThan(0);
    for (const label of ['Focused Information Gathering (0–2)', 'Closed-Loop Team Communication (0–3)', 'Efficiency Deduction (−2–0)', 'Orders/Monitoring Quality (0–3)', 'Clinical Reasoning/Documentation (0–2)', 'Safety Deduction (0, −1, −2)']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByText('STAT CBC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Focused escalation tied to the CBC result.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Document the reassessment result and plan change.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/message count and timing are not scored/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Observed action Evidence-linked review')).not.toBeInTheDocument();
  });
});
