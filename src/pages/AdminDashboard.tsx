import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, FileText, GraduationCap, School, TrendingUp, Users } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import StudentDashboard from './StudentDashboard';
import TestRooms from './TestRooms';
import type { Database } from '../lib/database.types';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import { hasAdminAccess, isSuperAdmin, isTestUser } from '../lib/roles';
import { computeCohortMetrics, type AnalyticsAssignment, type CohortMetrics } from '../lib/analyticsMetrics';

type AssignmentRow = Database['public']['Tables']['student_room_assignments']['Row'];

type DashboardStats = {
  studentCount: number;
  assignmentCount: number;
  completedAssignments: number;
  activeRoomCount: number;
  adminCount: number;
  averageScore: number | null;
  cohortMetrics: CohortMetrics;
};

const initialStats: DashboardStats = {
  studentCount: 0,
  assignmentCount: 0,
  completedAssignments: 0,
  activeRoomCount: 0,
  adminCount: 0,
  averageScore: null,
  cohortMetrics: computeCohortMetrics([], 0),
};

const formatDayPartGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, profile, activeSchoolId } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasAdmin = hasAdminAccess(profile);
  const isTester = isTestUser(profile);
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;

  useEffect(() => {
    if (!user || !hasAdmin) {
      return;
    }

    let isMounted = true;

    const loadDashboard = async () => {
      setLoading(true);
      setError(null);
      try {
        let studentQuery = supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'student');
        if (scopedSchoolId) {
          studentQuery = studentQuery.eq('school_id', scopedSchoolId);
        }

        let adminQuery = supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .in('role', ['school_admin', 'super_admin']);
        if (scopedSchoolId) {
          adminQuery = adminQuery.eq('school_id', scopedSchoolId);
        }

        const loadAssignmentRows = async () => {
          const rows: Array<Pick<AssignmentRow, 'status' | 'feedback_status' | 'student_id' | 'communication_score' | 'mdm_score' | 'grade' | 'nurse_feedback'>> = [];
          const pageSize = 1000;
          let from = 0;

          while (true) {
            let query = supabase
              .from('student_room_assignments')
              .select('status, feedback_status, student_id, communication_score, mdm_score, grade, nurse_feedback')
              .range(from, from + pageSize - 1);
            if (scopedSchoolId) {
              query = query.eq('school_id', scopedSchoolId);
            }

            const { data, error: queryError } = await query;
            if (queryError) throw queryError;
            const page = (data ?? []) as typeof rows;
            rows.push(...page);
            if (page.length < pageSize) break;
            from += pageSize;
          }

          return rows;
        };

        const buildAssignmentCountQuery = () => {
          let query = supabase
            .from('student_room_assignments')
            .select('id', { count: 'exact', head: true })
            .neq('status', 'cancelled');
          if (scopedSchoolId) query = query.eq('school_id', scopedSchoolId);
          return query;
        };

        const buildCompletedCountQuery = () => {
          let query = supabase
            .from('student_room_assignments')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'completed');
          if (scopedSchoolId) query = query.eq('school_id', scopedSchoolId);
          return query;
        };

        const buildAssessedCountQuery = () => {
          let query = supabase
            .from('student_room_assignments')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'completed')
            .eq('feedback_status', 'completed');
          if (scopedSchoolId) query = query.eq('school_id', scopedSchoolId);
          return query;
        };

        let roomsQuery = supabase
          .from('rooms')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true);
        if (scopedSchoolId) {
          // Include rooms available to all schools (empty array)
          roomsQuery = roomsQuery.or(`school_id.eq.${scopedSchoolId},available_school_ids.cs.{${scopedSchoolId}},available_school_ids.cs.{}`);
        }

        const [
          studentResult,
          adminResult,
          assignmentRows,
          assignmentCountResult,
          completedCountResult,
          assessedCountResult,
          roomsResult,
        ] = await Promise.all([
          studentQuery,
          adminQuery,
          loadAssignmentRows(),
          buildAssignmentCountQuery(),
          buildCompletedCountQuery(),
          buildAssessedCountQuery(),
          roomsQuery,
        ]);

        if (!isMounted) return;

        if (studentResult.error) throw studentResult.error;
        if (adminResult.error) throw adminResult.error;
        if (assignmentCountResult.error) throw assignmentCountResult.error;
        if (completedCountResult.error) throw completedCountResult.error;
        if (assessedCountResult.error) throw assessedCountResult.error;
        if (roomsResult.error) throw roomsResult.error;

        const cohortAssignments: AnalyticsAssignment[] = assignmentRows.map((row) => ({
          status: row.status,
          feedbackStatus: row.feedback_status,
          studentId: row.student_id,
          communicationScore: row.communication_score,
          mdmScore: row.mdm_score,
          overallScore: row.grade,
        }));
        const computedCohortMetrics = computeCohortMetrics(cohortAssignments, studentResult.count ?? 0);
        const eligibleAssignments = assignmentCountResult.count ?? computedCohortMetrics.eligibleAssignments;
        const completedAssignments = completedCountResult.count ?? computedCohortMetrics.completedAssignments;
        const assessedAssignments = assessedCountResult.count ?? computedCohortMetrics.assessedAssignments;
        const cohortMetrics = {
          ...computedCohortMetrics,
          eligibleAssignments,
          completedAssignments,
          assessedAssignments,
          completionRate: eligibleAssignments > 0 ? Number(((completedAssignments / eligibleAssignments) * 100).toFixed(1)) : null,
          assessmentCoverageRate: completedAssignments > 0 ? Number(((assessedAssignments / completedAssignments) * 100).toFixed(1)) : null,
        };
        const scoreValues = assignmentRows
          .filter((row) => row.status === 'completed' && row.feedback_status === 'completed')
          .flatMap((row) => [row.communication_score, row.mdm_score])
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

        const averageScore = scoreValues.length
          ? Number((scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length).toFixed(1))
          : null;

        setStats({
          studentCount: studentResult.count ?? 0,
          adminCount: adminResult.count ?? 0,
          assignmentCount: assignmentCountResult.count ?? 0,
          completedAssignments: completedCountResult.count ?? 0,
          activeRoomCount: roomsResult.count ?? 0,
          averageScore,
          cohortMetrics,
        });

      } catch (err) {
        console.error('Failed to load admin dashboard', err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Unable to load dashboard data.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [user, hasAdmin, scopedSchoolId]);

  const firstName = useMemo(() => {
    if (!profile?.full_name) return 'there';
    const [first] = profile.full_name.split(' ');
    return first || 'there';
  }, [profile?.full_name]);

  const outstandingAssignments = useMemo(() => {
    const { assignmentCount, completedAssignments } = stats;
    return Math.max(assignmentCount - completedAssignments, 0);
  }, [stats]);

  if (!hasAdmin) {
    return isTester ? <TestRooms /> : <StudentDashboard />;
  }

  return (
    <AdminLayout>
      <div className="px-6 py-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
          <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-blue-50 via-white to-white p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Overview</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">
              {formatDayPartGreeting()}, {firstName}.
            </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Keep tabs on student assignments, review automated feedback, and ensure every simulated room stays ready for practice.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <div>Active assignments requiring review: <span className="font-semibold text-slate-900">{outstandingAssignments}</span></div>
                <div className="hidden sm:inline-block h-4 w-px bg-slate-200" aria-hidden="true" />
                <div>Total active rooms: <span className="font-semibold text-slate-900">{stats.activeRoomCount}</span></div>
              </div>
            </section>
          </div>
          <SchoolScopeSelector className="w-full sm:w-60" label="Viewing" />
        </div>

            {error && (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {[{
                    title: 'Total Students',
                    value: stats.studentCount,
                    description: 'Non-admin profiles',
                    icon: GraduationCap,
                    accent: 'bg-blue-100 text-blue-600',
                  }, {
                    title: 'Case Assignments',
                    value: stats.assignmentCount,
                    description: `${stats.completedAssignments} completed`,
                    icon: FileText,
                    accent: 'bg-emerald-100 text-emerald-600',
                  }, {
                    title: 'Average Score',
                    value: stats.averageScore ?? '—',
                    description: 'Current rubric scores only (0–5)',
                    icon: TrendingUp,
                    accent: 'bg-purple-100 text-purple-600',
                  }, {
                    title: 'Active Rooms',
                    value: stats.activeRoomCount,
                    description: 'Rooms available to assign',
                    icon: School,
                    accent: 'bg-amber-100 text-amber-600',
                  }, {
                    title: 'Admin Users',
                    value: stats.adminCount,
                    description: 'Team members with admin access',
                    icon: Users,
                    accent: 'bg-slate-200 text-slate-700',
                  }].map((card) => (
                    <article key={card.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-500">{card.title}</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
                        </div>
                        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${card.accent}`}>
                          <card.icon className="h-5 w-5" />
                        </span>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">{card.description}</p>
                    </article>
                  ))}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Cohort analytics</h3>
                      <p className="text-sm text-slate-500">
                        Scoped to the selected school. Counts use metric contract {stats.cohortMetrics.metricVersion}.
                      </p>
                    </div>
                    <p className="text-xs text-slate-500">Score source: recorded assignment feedback</p>
                  </div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      {
                        label: 'Completion',
                        value: stats.cohortMetrics.completionRate,
                        detail: `${stats.cohortMetrics.completedAssignments}/${stats.cohortMetrics.eligibleAssignments} opportunities`,
                      },
                      {
                        label: 'Assessment coverage',
                        value: stats.cohortMetrics.assessmentCoverageRate,
                        detail: `${stats.cohortMetrics.assessedAssignments}/${stats.cohortMetrics.completedAssignments} completed`,
                      },
                      {
                        label: 'Learners represented',
                        value: stats.cohortMetrics.participationRate,
                        detail: `${stats.cohortMetrics.participatingLearners}/${stats.cohortMetrics.eligibleLearners} learners`,
                      },
                      {
                        label: 'Pending reviews',
                        value: stats.cohortMetrics.pendingReviews,
                        detail: 'Completed opportunities awaiting feedback review',
                        raw: true,
                      },
                    ].map((metric) => (
                      <article key={metric.label} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{metric.label}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">
                          {metric.raw ? metric.value ?? 0 : metric.value == null ? '—' : `${metric.value}%`}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">{metric.detail}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="grid gap-6">
                  <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-900">Quick Actions</h3>
                    <p className="text-sm text-slate-500">Jump straight into common admin workflows</p>
                    <div className="mt-6 space-y-3">
                      {[{
                        title: 'Assign new cases',
                        description: 'Distribute scenarios to students or cohorts',
                        action: () => navigate('/admin/assignments'),
                      }, {
                        title: 'Manage rooms',
                        description: 'Update case details and upload new PDFs',
                        action: () => navigate('/admin/rooms'),
                      }, {
                        title: 'Update profile',
                        description: 'Adjust your contact details and preferences',
                        action: () => navigate('/profile'),
                      }].map((action) => (
                        <button
                          key={action.title}
                          type="button"
                          onClick={action.action}
                          className="block w-full rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50"
                        >
                          <p className="text-sm font-semibold text-slate-900">{action.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{action.description}</p>
                        </button>
                      ))}
                    </div>
                  </article>
                </section>
              </div>
            )}
      </div>
    </AdminLayout>
  );
}
