import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { isSuperAdmin } from '../lib/roles';

type ReportSummary = {
  totalSchools: number;
  totalStudents: number;
  totalTestUsers: number;
  totalAdmins: number;
  totalRooms: number;
  activeRooms: number;
  totalAssignments: number;
  completedAssignments: number;
  feedbackPending: number;
};

type SchoolSummary = {
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  students: number;
  testUsers: number;
  admins: number;
  activeRooms: number;
  assignmentsTotal: number;
  assignmentsCompleted: number;
};

type RecentAssignment = {
  id: string;
  createdAt: string;
  status: string;
  feedbackStatus: string | null;
  grade: number | null;
  schoolId: string | null;
  studentName: string | null;
  roomNumber: string | null;
};

type SuperAdminReport = {
  generatedAt: string;
  summary: ReportSummary;
  schools: SchoolSummary[];
  recentAssignments: RecentAssignment[];
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'in_progress':
      return 'In Progress';
    case 'completed':
      return 'Completed';
    case 'bedside':
      return 'Bedside';
    case 'assigned':
      return 'Assigned';
    default:
      return status;
  }
};

export default function SuperAdminPortal() {
  const { user, profile } = useAuthStore();
  const [report, setReport] = useState<SuperAdminReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isSuperAdmin(profile)) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadReport = async () => {
      setLoading(true);
      setError(null);

      const { data, error: invokeError } = await supabase.functions.invoke('superadmin-report');

      if (!isMounted) return;

      if (invokeError) {
        setError(invokeError.message ?? 'Failed to load superadmin report.');
        setLoading(false);
        return;
      }

      setReport(data as SuperAdminReport);
      setLoading(false);
    };

    void loadReport();

    return () => {
      isMounted = false;
    };
  }, [user, profile]);

  const completionRate = useMemo(() => {
    if (!report?.summary.totalAssignments) return 0;
    return Math.round((report.summary.completedAssignments / report.summary.totalAssignments) * 100);
  }, [report]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin(profile)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AdminLayout>
      <div className="px-6 py-6 space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Superadmin</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Operational Report</h1>
          <p className="mt-2 text-sm text-slate-600">
            Curated, read-only platform metrics for cross-school operations.
          </p>
        </section>

        {loading ? (
          <div className="flex h-[40vh] items-center justify-center rounded-2xl border border-slate-200 bg-white">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : report ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <article className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Schools</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{report.summary.totalSchools}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Students</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{report.summary.totalStudents}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Active Rooms</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{report.summary.activeRooms}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Assignments</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{report.summary.totalAssignments}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Completion Rate</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{completionRate}%</p>
              </article>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-slate-900">School Breakdown</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">School</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Students</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Test Users</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Admins</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Active Rooms</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Assignments</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.schools.map((school) => (
                      <tr key={school.schoolId}>
                        <td className="px-3 py-2 text-sm text-slate-800">
                          <p className="font-medium">{school.schoolName}</p>
                          <p className="text-xs text-slate-500">{school.schoolSlug}</p>
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">{school.students}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{school.testUsers}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{school.admins}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{school.activeRooms}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{school.assignmentsTotal}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{school.assignmentsCompleted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Recent Assignments</h2>
                <p className="text-xs text-slate-500">Updated {new Date(report.generatedAt).toLocaleString()}</p>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Created</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Student</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Room</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.recentAssignments.map((assignment) => (
                      <tr key={assignment.id}>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          {new Date(assignment.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">{assignment.studentName ?? 'Unassigned'}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{assignment.roomNumber ?? '—'}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{statusLabel(assignment.status)}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{assignment.feedbackStatus ?? '—'}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          {typeof assignment.grade === 'number' ? assignment.grade : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No data returned.
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
