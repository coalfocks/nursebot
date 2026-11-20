import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ list: vi.fn(), start: vi.fn(), promote: vi.fn() }));
vi.mock('../../lib/feedbackRerun', async (importActual) => ({
  ...(await importActual<typeof import('../../lib/feedbackRerun')>()),
  listFeedbackRerunVersions: mocks.list, startFeedbackRerun: mocks.start, promoteFeedbackRerun: mocks.promote,
}));
import { FeedbackRerunPanel } from './FeedbackRerunPanel';

const comp = (score: number) => ({ score, feedback: 'x' });
const assignment = { id: 'a1', status: 'completed', feedback_generated_at: '2026-11-01T00:00:00Z', communication_score: 4, mdm_score: 3, communication_breakdown: { focused_information_gathering: comp(2) }, mdm_breakdown: {}, safety_result: { level: 'none' }, feedback_debrief: {} };
const done = { id: 'v1', assignment_id: 'a1', status: 'completed', technical_incomplete: false, error: null, created_at: '2026-11-20T10:00:00Z', promoted_at: null, provenance: {}, result: { evaluation: { communication_score: 5, clinical_reasoning_score: 3, communication_breakdown: {}, clinical_reasoning_breakdown: {}, safety_result: { level: 'none' } }, debrief: {} } };

describe('FeedbackRerunPanel', () => {
  beforeEach(() => { mocks.list.mockReset(); mocks.start.mockReset(); mocks.promote.mockReset(); });

  it('renders nothing for an incomplete assignment', () => {
    mocks.list.mockResolvedValue([]);
    const { container } = render(<FeedbackRerunPanel assignment={{ ...assignment, status: 'in_progress' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('is compare-only by default: rerunning starts a version and never promotes', async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValue([done]);
    mocks.start.mockResolvedValue('v1');
    render(<FeedbackRerunPanel assignment={assignment} />);
    fireEvent.click(screen.getByText('Rerun for comparison'));
    await waitFor(() => expect(screen.getByText('Saved (official)')).toBeTruthy());
    expect(mocks.start).toHaveBeenCalledWith('a1');
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it('keeps Promote disabled until PROMOTE is typed, then promotes that version only', async () => {
    mocks.list.mockResolvedValue([done]);
    mocks.promote.mockResolvedValue(undefined);
    render(<FeedbackRerunPanel assignment={assignment} />);
    const button = await screen.findByText('Promote to official result');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Promote confirmation'), { target: { value: 'promote' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Promote confirmation'), { target: { value: 'PROMOTE' } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.promote).toHaveBeenCalledWith('a1', 'v1', 'PROMOTE'));
  });

  it('shows a failed rerun and states the saved result is unchanged', async () => {
    mocks.list.mockResolvedValue([{ ...done, status: 'failed', result: null, error: 'model timeout' }]);
    render(<FeedbackRerunPanel assignment={assignment} />);
    expect(await screen.findByText(/model timeout/)).toBeTruthy();
    expect(screen.getByText(/saved result is unchanged/)).toBeTruthy();
  });
});
