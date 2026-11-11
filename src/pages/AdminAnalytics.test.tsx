import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { writeFileSync } from 'node:fs';
import { analyticsFixture } from '../test/analyticsFixture';
const mocks = vi.hoisted(() => ({ rows: [] as unknown[], eq: vi.fn(), download: vi.fn(), navigate: vi.fn(), auth: { user: { id: 'synthetic-admin' }, profile: { role: 'school_admin', school_id: 'synthetic-school' }, activeSchoolId: null } }));
vi.mock('../components/admin/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../components/admin/SchoolScopeSelector', () => ({ default: () => <span>Synthetic Training School</span> }));
vi.mock('../stores/authStore', () => ({ useAuthStore: () => mocks.auth }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../lib/analyticsExport', () => ({ downloadAnalyticsWorkbook: mocks.download }));
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
 const query = { select: () => query, order: () => query, range: () => query, eq: (...args: unknown[]) => { mocks.eq(...args); return query; }, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mocks.rows, error: null }).then(resolve) };
 return query;
} } }));
import AdminAnalytics from './AdminAnalytics';

it('applies school/learner scope to named safety review and Excel, with prominent domains and minimum cohort themes', async () => {
 mocks.rows = Array.from({ length: 3 }, (_, i) => {
  const row = analyticsFixture(i, { safetyResult: i === 0 ? { level: 'critical', rationale: 'Synthetic contraindicated order', action: 'Synthetic action' } : null });
  return { id: row.id, school_id: row.schoolId, school: { id: row.schoolId, name: row.schoolName }, is_sandbox: false, student_id: row.studentId, room_id: row.roomId, status: row.status, feedback_status: row.feedbackStatus, communication_score: row.communicationScore, mdm_score: row.mdmScore, created_at: row.createdAt, scoring_start_at: row.scoringStartAt, safety_result: row.safetyResult, completed_at: row.completedAt, communication_breakdown: row.communicationBreakdown, mdm_breakdown: row.mdmBreakdown, feedback_debrief: row.feedbackDebrief, student: { id: row.studentId, full_name: row.studentName, role: row.studentRole }, room: { id: row.roomId, room_number: row.roomNumber, specialty_id: null, specialty_ids: [] } };
 });
 render(<AdminAnalytics />);
 await screen.findByRole('heading', { name: 'Domain performance and subscores' });
 expect(mocks.eq).toHaveBeenCalledWith('school_id', 'synthetic-school');
 expect(mocks.eq).toHaveBeenCalledWith('is_sandbox', false);
 expect(screen.queryByText('Eligible attempts')).not.toBeInTheDocument();
 expect(screen.getByText('Completed cases with feedback')).toBeInTheDocument();
 expect(screen.getAllByText(/3 learners/).length).toBeGreaterThan(0);
 const details = screen.getByText('Learner attempts and evidence links (3)').closest('details');
 expect(details).not.toHaveAttribute('open');
 expect(screen.getByRole('heading', { name: 'Domain performance and subscores' }).compareDocumentPosition(details!) & 4).toBe(4);
 fireEvent.click(screen.getByRole('button', { name: 'Review attempt' }));
 expect(mocks.navigate).toHaveBeenCalledWith('/assignment/synthetic-attempt-0');
 if (process.env.ANALYTICS_QA_HTML) writeFileSync(process.env.ANALYTICS_QA_HTML, document.documentElement.outerHTML);
 fireEvent.change(screen.getByLabelText('Minimum learners per theme'), { target: { value: '5' } });
 expect(screen.getAllByText(/No evidence-backed theme meets the 5-learner minimum/)).toHaveLength(2);
 fireEvent.change(screen.getByLabelText('Learner'), { target: { value: 'synthetic-learner-1' } });
 expect(screen.queryByText('Synthetic contraindicated order')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
 await waitFor(() => expect(mocks.download).toHaveBeenCalled());
 expect(mocks.download.mock.calls[0][0]).toHaveLength(1);
 expect(mocks.download.mock.calls[0][0][0].id).toBe('synthetic-attempt-1');
 fireEvent.click(screen.getByRole('button', { name: 'Selected learner' }));
 expect(screen.getByText('Focused escalation to the senior clinician')).toBeInTheDocument();
});
