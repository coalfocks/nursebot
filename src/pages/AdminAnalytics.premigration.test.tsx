import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { analyticsFixture } from '../test/analyticsFixture';

const PROD_ERROR = { code: '42703', details: null, hint: null, message: 'column student_room_assignments.case_started_at does not exist' };
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  selects: [] as string[],
  mode: 'premigration' as 'premigration' | 'other-error',
  rows: [] as Array<Record<string, unknown>>,
  auth: { user: { id: 'synthetic-admin' }, profile: { role: 'school_admin', school_id: 'synthetic-school' }, activeSchoolId: null },
}));
vi.mock('../components/admin/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../components/admin/SchoolScopeSelector', () => ({ default: () => <span>Synthetic Training School</span> }));
vi.mock('../stores/authStore', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../lib/analyticsExport', () => ({ downloadAnalyticsWorkbook: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  let select = '';
  const query = {
    select: (value: string) => { select = value; mocks.selects.push(value); return query; },
    order: () => query, range: () => query, eq: () => query,
    then: (resolve: (value: unknown) => unknown) => {
      if (mocks.mode === 'other-error') return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for table student_room_assignments' } }).then(resolve);
      if (select.includes('case_started_at')) return Promise.resolve({ data: null, error: PROD_ERROR }).then(resolve);
      return Promise.resolve({ data: mocks.rows, error: null }).then(resolve);
    },
  };
  return query;
} } }));
import AdminAnalytics from './AdminAnalytics';

const rawRow = (index: number) => {
  const row = analyticsFixture(index, {});
  return { id: row.id, school_id: row.schoolId, school: { id: row.schoolId, name: row.schoolName }, is_sandbox: false, student_id: row.studentId, room_id: row.roomId, status: row.status, feedback_status: row.feedbackStatus, communication_score: row.communicationScore, mdm_score: row.mdmScore, created_at: row.createdAt, scoring_start_at: row.scoringStartAt, safety_result: row.safetyResult, completed_at: row.completedAt, communication_breakdown: row.communicationBreakdown, mdm_breakdown: row.mdmBreakdown, feedback_debrief: row.feedbackDebrief, student: { id: row.studentId, full_name: row.studentName, role: row.studentRole }, room: { id: row.roomId, room_number: row.roomNumber, specialty_id: null, specialty_ids: [] } };
};

beforeEach(() => { mocks.selects = []; mocks.mode = 'premigration'; mocks.rows = [0, 1, 2].map(rawRow); });

it('pre-migration database: retries without case_started_at, renders the other analytics, and marks timing unavailable with a reason', async () => {
  render(<AdminAnalytics />);
  await screen.findByRole('heading', { name: 'Domain performance and subscores' });
  expect(mocks.selects).toHaveLength(2);
  expect(mocks.selects[0]).toContain('case_started_at');
  expect(mocks.selects[1]).not.toContain('case_started_at');
  expect(screen.queryByText(/Analytics could not be loaded/)).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/Case Start timing is unavailable/);
  expect(screen.getByText('Completed with feedback')).toBeInTheDocument();
  // No timestamp is estimated: there are zero valid timing samples, each completed attempt is excluded with the reason.
  expect(screen.getByText(/valid n = 0 · completed n = 3/)).toBeInTheDocument();
  expect(screen.getAllByText(/database not yet migrated to record Case Start/).length).toBeGreaterThan(0);
});

it('any other load failure still fails the load and shows the real error message', async () => {
  mocks.mode = 'other-error';
  render(<AdminAnalytics />);
  expect(await screen.findByText('Analytics could not be loaded: permission denied for table student_room_assignments [42501].')).toBeInTheDocument();
  expect(mocks.selects).toHaveLength(1);
});
