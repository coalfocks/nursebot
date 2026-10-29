import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssignmentManager from './AssignmentManager';

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let createCallCount = 0;
let committedIds: string[] = [];
let assignmentRows: unknown[] = [];

const student = {
  id: 'student-1',
  full_name: 'Student One',
  study_year: 3,
  email: 'student@example.com',
  role: 'student',
  school_id: 'school-1',
  specialization_interest: null,
  created_at: new Date().toISOString(),
};

const room = (id: number, number: string) => ({
  id,
  room_number: number,
  school_id: 'school-1',
  available_school_ids: [],
  specialty_id: null,
  difficulty_level: 'standard',
  case_goals: null,
  orders_config: { labs: [{ name: 'CBC', type: 'lab' }] },
});

const query = (table: string) => {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    or: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
      const data = table === 'chat_messages'
        ? [{ id: 'chat-complete', role: 'consultant', content: '<completed>', created_at: '2099-01-01T10:00:00Z' }]
        : table === 'patient_chat_messages'
          ? [{ id: 'patient-1', role: 'patient', content: 'Patient reply', created_at: '2099-01-01T09:01:00Z' }]
          : table === 'consultant_chat_messages'
            ? [{ id: 'consultant-1', role: 'student', content: 'Consultant question', created_at: '2099-01-01T09:02:00Z' }]
            : table === 'medical_orders'
              ? [{ id: 'order-1', order_name: 'CBC', instructions: 'Draw now', created_at: '2099-01-01T09:03:00Z' }]
              : table === 'profiles'
                ? [student]
                : table === 'rooms'
                  ? [room(204, '204'), room(304, '304')]
                  : table === 'student_room_assignments'
                    ? (committedIds.length ? committedIds.map((id) => ({ id })) : assignmentRows)
                    : table === 'mar_assignment_materialization_operations'
                      ? committedIds.map((id) => ({ assignment_id: id }))
                      : [];
      return Promise.resolve(resolve({ data, error: null }));
    },
  };
  return builder;
};

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => query(table)),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'publish_mar_case_version_from_manual_packet') {
        return { data: { caseVersion: `manual-v-${args.p_room_id}` }, error: null };
      }
      if (name === 'get_mar_normal_materialization_readiness') {
        return { data: { ready: true, atomic: true, materializationVersion: 2 }, error: null };
      }
      if (name === 'create_assignment_with_mar_materialization') {
        createCallCount += 1;
        const id = String(args.p_assignment_id);
        if (!committedIds.includes(id)) committedIds.push(id);
        if (createCallCount === 2) return { data: null, error: new Error('simulated lost response after commit') };
      }
      return { data: null, error: null };
    }),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'admin-1' },
    profile: { id: 'admin-1', role: 'school_admin', school_id: 'school-1' },
    activeSchoolId: null,
  }),
}));

vi.mock('../lib/roles', () => ({ hasAdminAccess: () => true, isSuperAdmin: () => false }));
vi.mock('../lib/assignmentQueries', () => ({ fetchAssignmentList: vi.fn(async () => assignmentRows) }));
vi.mock('../components/admin/AdminLayout', () => ({ default: ({ children }: { children: unknown }) => <>{children}</> }));
vi.mock('../components/admin/SchoolScopeSelector', () => ({ default: () => null }));
vi.mock('../lib/feedbackSheet', () => ({
  FeedbackSheet: () => null,
  feedbackSheetStyles: '',
  mapFeedbackSheet: vi.fn(),
  renderFeedbackSheetHtml: vi.fn(),
}));

describe('AssignmentManager frozen creation operation', () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    createCallCount = 0;
    committedIds = [];
    assignmentRows = [];
    window.alert = vi.fn();
  });

  it('retries a partial commit through the mounted handler with identical IDs, versions, and schedule', async () => {
    render(<AssignmentManager />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Case Assignments' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Assign Cases' }));
    fireEvent.click(screen.getByRole('button', { name: /Room 204/ }));
    fireEvent.click(screen.getByRole('button', { name: /Room 304/ }));
    fireEvent.click(screen.getByRole('button', { name: /Student One/ }));

    const inputs = screen.getAllByDisplayValue('');
    const dateInputs = inputs.filter((input) => input.getAttribute('type') === 'datetime-local');
    fireEvent.change(dateInputs[0], { target: { value: '2099-01-01T09:00' } });
    fireEvent.change(dateInputs[1], { target: { value: '2099-01-01T10:00' } });

    const createButton = () => screen.getByRole('button', { name: 'Create 2 assignments' });
    fireEvent.click(createButton());
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('simulated lost response')));

    const firstAttempt = rpcCalls.filter((call) => call.name === 'create_assignment_with_mar_materialization');
    expect(firstAttempt).toHaveLength(2);
    fireEvent.click(createButton());
    await waitFor(() => expect(screen.queryByText('Assign Case')).not.toBeInTheDocument());

    const attempts = rpcCalls.filter((call) => call.name === 'create_assignment_with_mar_materialization');
    expect(attempts).toHaveLength(4);
    expect(attempts.slice(2).map((call) => call.args.p_assignment_id)).toEqual(firstAttempt.map((call) => call.args.p_assignment_id));
    expect(attempts.slice(2).map((call) => call.args.p_case_version)).toEqual(firstAttempt.map((call) => call.args.p_case_version));
    expect(attempts.slice(2).map((call) => call.args.p_effective_date)).toEqual(firstAttempt.map((call) => call.args.p_effective_date));
  });

  it('shows saved note, hint view, and truthful completion role in the mounted timeline', async () => {
    assignmentRows = [{
      id: 'completed-1',
      status: 'completed',
      effective_date: '2099-01-01T08:00:00Z',
      window_start: '2099-01-01T08:00:00Z',
      window_end: '2099-01-01T10:00:00Z',
      student: student,
      room: { room_number: '203' },
      student_progress_note: 'Observed bedside findings recorded.',
      completion_hint_views: { assessmentHint: { viewedAt: '2099-01-01T09:04:00Z' } },
    }];
    render(<AssignmentManager />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Student timeline' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Student timeline' }));
    await waitFor(() => expect(screen.getByText('Student progress note (save time not recorded)')).toBeInTheDocument());
    expect(screen.getByText('Assessment hint viewed')).toBeInTheDocument();
    expect(screen.getByText('Assignment completed')).toBeInTheDocument();
    expect(screen.queryByText('Nurse message')).not.toBeInTheDocument();
  });
});
