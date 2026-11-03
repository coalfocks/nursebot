import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssignmentView from './AssignmentView';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  channel: vi.fn(),
  navigate: vi.fn(),
  assignment: null as Record<string, unknown> | null,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate, useParams: () => ({ assignmentId: 'assignment-1' }) };
});

vi.mock('../stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'student-1' } }) }));
vi.mock('../lib/roomHelpers', () => ({ fetchSpecialtiesForRoom: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/assignmentBaseline', () => ({ resolveAssignmentRoom: (room: unknown) => room }));
vi.mock('../lib/supabase', () => ({ supabase: { from: mocks.from, channel: mocks.channel } }));
vi.mock('../components/Navbar', () => ({ default: () => <nav /> }));
vi.mock('../components/ChatInterface', () => ({ ChatInterface: () => <div data-testid="nurse-chat" /> }));
vi.mock('../components/ConsultantPortal', () => ({ ConsultantPortal: () => <div data-testid="consultant-portal" /> }));
vi.mock('../components/FeedbackSidebar', () => ({ FeedbackSidebar: () => <aside data-testid="feedback-sidebar" /> }));

const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'assignment-1',
  student_id: 'student-1',
  status: 'in_progress',
  feedback_status: null,
  communication_score: null,
  mdm_score: null,
  scenario_baseline: null,
  room: { id: 7, room_number: '7', specialties: [], difficulty_level: 'Standard' },
  ...overrides,
});

const installSupabase = () => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(async () => ({ data: mocks.assignment, error: null })),
  };
  mocks.from.mockReturnValue(query);
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel), unsubscribe: vi.fn() };
  mocks.channel.mockReturnValue(channel);
};

describe('AssignmentView resource removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assignment = makeAssignment();
    installSupabase();
  });

  it('renders the active view without Room Resources and preserves contextual Open EHR navigation', async () => {
    render(<AssignmentView />);
    await waitFor(() => expect(screen.getByText('Room 7')).toBeInTheDocument());

    expect(screen.queryByText('Room Resources')).not.toBeInTheDocument();
    expect(screen.queryByText('Window')).not.toBeInTheDocument();
    expect(screen.queryByText('Go to EHR')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open EHR' })).toBeInTheDocument();
    expect(screen.getByTestId('consultant-portal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open EHR' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/emr?assignmentId=assignment-1&roomId=7');
  });

  it('keeps completed feedback and uses the full-width layout when no feedback is available', async () => {
    mocks.assignment = makeAssignment({ status: 'completed', communication_score: 4.5 });
    const { unmount } = render(<AssignmentView />);
    await waitFor(() => expect(screen.getByTestId('feedback-sidebar')).toBeInTheDocument());
    expect(screen.queryByText('Room Resources')).not.toBeInTheDocument();

    unmount();
    mocks.assignment = makeAssignment({ status: 'completed' });
    render(<AssignmentView />);
    await waitFor(() => expect(screen.queryByTestId('feedback-sidebar')).not.toBeInTheDocument());
    expect(screen.getByTestId('nurse-chat').parentElement?.parentElement).toHaveClass('lg:col-span-3');
  });
});
