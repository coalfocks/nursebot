import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ check: vi.fn(), profile: { role: 'super_admin' } as { role: string } | null }));
vi.mock('../lib/feedbackService', () => ({ checkPendingFeedback: mocks.check }));
vi.mock('../stores/authStore', () => ({ useAuthStore: () => ({ profile: mocks.profile }) }));

import FeedbackProcessor from './FeedbackProcessor';

const SCOPED = '11111111-1111-4111-8111-111111111111';

describe('FeedbackProcessor', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.check.mockReset(); mocks.profile = { role: 'super_admin' }; });
  afterEach(() => { vi.useRealTimers(); });

  it('does nothing for any admin when the processor is not opted in', () => {
    render(<FeedbackProcessor config={{ enabled: false, assignmentIds: null }} />);
    vi.advanceTimersByTime(120_000);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('runs on load and every 30 seconds only when opted in, passing the allowlist scope', () => {
    const { unmount } = render(<FeedbackProcessor config={{ enabled: true, assignmentIds: [SCOPED] }} />);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.check).toHaveBeenLastCalledWith({ assignmentIds: [SCOPED] });
    vi.advanceTimersByTime(30_000);
    expect(mocks.check).toHaveBeenCalledTimes(2);
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it('does not run for non-admin users even when opted in', () => {
    mocks.profile = { role: 'student' };
    render(<FeedbackProcessor config={{ enabled: true, assignmentIds: null }} />);
    vi.advanceTimersByTime(60_000);
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
