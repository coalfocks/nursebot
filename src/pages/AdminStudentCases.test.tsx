import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminStudentCases from './AdminStudentCases';

vi.mock('../components/admin/AdminLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    profile: { id: 'admin-1', role: 'school_admin', school_id: 'school-1' },
    activeSchoolId: null,
  }),
}));

vi.mock('../lib/roles', () => ({
  hasAdminAccess: () => true,
  isSuperAdmin: () => false,
}));

vi.mock('../lib/programTracks', () => ({
  LEARNER_PROGRAMS: [{ value: 'medical', label: 'Medical' }],
  getLearnerProgramLabel: () => 'Medical',
}));

vi.mock('../lib/roomHelpers', () => ({
  fetchSpecialtiesForRoom: vi.fn().mockResolvedValue([]),
}));

const query = (data: unknown, error: null = null) => {
  const promise = Promise.resolve({ data, error });
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    single: () => promise,
    then: (resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
      promise.then(resolve, reject),
  };
  return builder;
};

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => table === 'profiles'
      ? query({ id: 'student-1', full_name: 'Student One', study_year: 2, learner_program: 'medical' })
      : query([{
        id: 'assignment-1',
        student_id: 'student-1',
        status: 'bedside',
        is_sandbox: false,
        school_id: 'school-1',
        room: { room_number: '101', specialties: [] },
      }]),
  },
}));

describe('AdminStudentCases assignment repair surface', () => {
  it('shows the student-specific assign action and preserves the Bedside status', async () => {
    render(
      <MemoryRouter initialEntries={['/students/student-1']}>
        <Routes>
          <Route path="/students/:studentId" element={<AdminStudentCases />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /assign case/i })).toHaveAttribute(
      'href',
      '/admin/assignments?studentId=student-1',
    );
    expect(await screen.findByText('Bedside')).toBeInTheDocument();
    expect(screen.queryByText('Completed', { selector: 'span' })).not.toBeInTheDocument();
  });
});
