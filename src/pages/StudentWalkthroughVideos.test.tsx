import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const state = {
  user: { id: 'student-1' },
  profile: { id: 'student-1', role: 'student', school_id: 'school-1' },
};

vi.mock('../stores/authStore', () => ({ useAuthStore: () => state }));
vi.mock('../components/Navbar', () => ({ default: () => null }));
vi.mock('../lib/roles', () => ({ isTestUser: () => false }));
vi.mock('../lib/supabase', () => {
  const course = { id: 'course-1', version: 1, title: 'Optional Student Preview', description: 'Preview', audience: 'student', status: 'published', is_mandatory: false };
  const item = { id: 'item-1', course_id: 'course-1', course_version: 1, video_id: 'video-1', video_version: 1, position: 0, required: true };
  const video = { id: 'video-1', version: 1, title: 'Visible lesson', description: '', learning_objective: 'Learn', topic: 'workflow', audience: 'student', onboarding_eligible: true, thumbnail_path: null, video_path: 'lesson.mp4', duration_seconds: 30, captions_path: null, transcript: 'Transcript', status: 'published', processing_status: 'ready' };
  const rows: Record<string, unknown> = {
    walkthrough_courses: course,
    walkthrough_course_items: [item],
    walkthrough_videos: [video],
    walkthrough_enrollments: null,
    walkthrough_sandbox_launches: { room_id: null, enabled: false },
  };
  const makeQuery = (table: string) => {
    const query: Record<string, unknown> = {};
    const chain = () => query;
    query.select = chain; query.eq = chain; query.in = chain; query.order = chain; query.limit = chain;
    query.maybeSingle = () => Promise.resolve({ data: rows[table] ?? null, error: null });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows[table] ?? [], error: null }));
    return query;
  };
  return {
    supabase: {
      from: (table: string) => makeQuery(table),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: '/lesson.mp4' }, error: null }) }) },
    },
  };
});

import StudentWalkthroughVideos from './StudentWalkthroughVideos';

describe('StudentWalkthroughVideos mounted contract', () => {
  it('renders a published student video player and preserves optional-course messaging', async () => {
    render(<StudentWalkthroughVideos />);
    expect(await screen.findByRole('heading', { name: 'Visible lesson' })).toBeInTheDocument();
    expect(screen.getByText(/optional preview/i)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', '/lesson.mp4'));
  });
});
