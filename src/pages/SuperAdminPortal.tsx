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
  assignmentEvaluationRows: AssignmentEvaluationRow[];
};

type AssignmentEvaluationRow = {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  effectiveDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  completedAt: string | null;
  status: string | null;
  feedbackStatus: string | null;
  feedbackGeneratedAt: string | null;
  feedbackError: string | null;
  grade: number | null;
  diagnosis: string | null;
  treatmentPlan: string[] | null;
  studentProgressNote: string | null;
  learningObjectives: string | null;
  communicationScore: number | null;
  mdmScore: number | null;
  communicationBreakdown: unknown;
  mdmBreakdown: unknown;
  nurseFeedback: unknown;
  school: {
    id: string;
    name: string;
    slug: string;
  } | null;
  room: {
    id: number;
    roomNumber: string;
    role: string | null;
    specialty: string | null;
  } | null;
  student: {
    id: string;
    fullName: string | null;
    email: string | null;
    role: string | null;
    schoolId: string | null;
  } | null;
  assignedBy: {
    id: string;
    fullName: string | null;
    email: string | null;
    role: string | null;
  } | null;
};

type LegacyFeedback = {
  summary?: string;
  recommendations?: string[];
};

type SectionBreakdown = {
  score?: number | null;
  feedback?: string | null;
};

type EfficiencyBreakdown = SectionBreakdown & {
  cau_count?: number | null;
  case_difficulty?: string | null;
};

type CommunicationBreakdown = {
  information_sharing?: SectionBreakdown | null;
  responsive_communication?: SectionBreakdown | null;
  efficiency_deduction?: EfficiencyBreakdown | null;
};

type MdmBreakdown = {
  labs_orders_quality?: SectionBreakdown | null;
  note_thought_process?: SectionBreakdown | null;
  safety_deduction?: SectionBreakdown | null;
};

type TimelineExportResponse = {
  assignmentId: string;
  fileName: string;
  html: string;
};

const asLegacyFeedback = (value: unknown): LegacyFeedback => {
  if (!value || typeof value !== 'object') return {};
  return value as LegacyFeedback;
};

const asCommunicationBreakdown = (value: unknown): CommunicationBreakdown => {
  if (!value || typeof value !== 'object') return {};
  return value as CommunicationBreakdown;
};

const asMdmBreakdown = (value: unknown): MdmBreakdown => {
  if (!value || typeof value !== 'object') return {};
  return value as MdmBreakdown;
};

const formatTimestamp = (value: string | null) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
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
  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentEvaluationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingAssignmentId, setExportingAssignmentId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

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

  const selectedCommunicationBreakdown = selectedAssignment
    ? asCommunicationBreakdown(selectedAssignment.communicationBreakdown)
    : {};
  const selectedMdmBreakdown = selectedAssignment
    ? asMdmBreakdown(selectedAssignment.mdmBreakdown)
    : {};

  const handleExportTimeline = async (assignment: AssignmentEvaluationRow) => {
    setExportError(null);
    setExportingAssignmentId(assignment.id);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('superadmin-report', {
        body: {
          action: 'export_assignment_timeline',
          assignmentId: assignment.id,
        },
      });

      if (invokeError) {
        throw invokeError;
      }

      const exportPayload = data as TimelineExportResponse | null;
      if (!exportPayload?.html || !exportPayload.fileName) {
        throw new Error('Timeline export returned an invalid payload.');
      }

      const blob = new Blob([exportPayload.html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportPayload.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportErr) {
      const message =
        exportErr instanceof Error ? exportErr.message : 'Failed to export assignment timeline.';
      setExportError(message);
    } finally {
      setExportingAssignmentId(null);
    }
  };

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

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Assignment Evaluation Dataset</h2>
                <p className="text-xs text-slate-500">
                  Joined with student and assigned-by user profiles ({report.assignmentEvaluationRows.length} rows)
                </p>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Created</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Student</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned By</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">School</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Room</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Grade</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Diagnosis</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Treatment Plan</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Window</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Completed</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.assignmentEvaluationRows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2 text-sm text-slate-700">{formatTimestamp(row.createdAt)}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          <p>{row.student?.fullName ?? '—'}</p>
                          <p className="text-xs text-slate-500">{row.student?.email ?? '—'}</p>
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          <p>{row.assignedBy?.fullName ?? '—'}</p>
                          <p className="text-xs text-slate-500">{row.assignedBy?.email ?? '—'}</p>
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">{row.school?.name ?? '—'}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{row.room?.roomNumber ?? '—'}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{row.status ?? '—'}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          <p>{row.feedbackStatus ?? '—'}</p>
                          <p className="text-xs text-slate-500">
                            {row.feedbackGeneratedAt ? `Generated ${formatTimestamp(row.feedbackGeneratedAt)}` : '—'}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          {typeof row.grade === 'number' ? row.grade : '—'}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700 max-w-[12rem] truncate" title={row.diagnosis ?? ''}>
                          {row.diagnosis ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          {row.treatmentPlan?.length ? `${row.treatmentPlan.length} item(s)` : '—'}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          <p>{row.windowStart ? new Date(row.windowStart).toLocaleDateString() : '—'}</p>
                          <p className="text-xs text-slate-500">
                            {row.windowEnd ? new Date(row.windowEnd).toLocaleDateString() : ''}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700">{formatTimestamp(row.completedAt)}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">
                          <button
                            type="button"
                            onClick={() => {
                              setExportError(null);
                              setSelectedAssignment(row);
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            View Feedback
                          </button>
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
      {selectedAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                Feedback Detail: {selectedAssignment.student?.fullName ?? 'Unknown Student'} ({selectedAssignment.id})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleExportTimeline(selectedAssignment)}
                  disabled={exportingAssignmentId === selectedAssignment.id}
                  className="inline-flex items-center rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {exportingAssignmentId === selectedAssignment.id ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Export Timeline
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAssignment(null);
                    setExportError(null);
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
            {exportError ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {exportError}
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-lg border border-slate-200 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Scoring</h4>
                <p className="mt-2 text-sm text-slate-700">
                  Communication: {typeof selectedAssignment.communicationScore === 'number' ? selectedAssignment.communicationScore : '—'}
                </p>
                <p className="text-sm text-slate-700">
                  MDM: {typeof selectedAssignment.mdmScore === 'number' ? selectedAssignment.mdmScore : '—'}
                </p>
                <p className="text-sm text-slate-700">
                  Grade: {typeof selectedAssignment.grade === 'number' ? selectedAssignment.grade : '—'}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Communication Breakdown</h4>
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <div>
                    <p className="font-medium text-slate-900">
                      Information Sharing
                      <span className="ml-2 text-slate-500">
                        ({typeof selectedCommunicationBreakdown.information_sharing?.score === 'number'
                          ? selectedCommunicationBreakdown.information_sharing.score
                          : '—'}
                        /2)
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{selectedCommunicationBreakdown.information_sharing?.feedback || '—'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">
                      Responsive Communication
                      <span className="ml-2 text-slate-500">
                        ({typeof selectedCommunicationBreakdown.responsive_communication?.score === 'number'
                          ? selectedCommunicationBreakdown.responsive_communication.score
                          : '—'}
                        /3)
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{selectedCommunicationBreakdown.responsive_communication?.feedback || '—'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">
                      Efficiency Deduction
                      <span className="ml-2 text-slate-500">
                        ({typeof selectedCommunicationBreakdown.efficiency_deduction?.score === 'number'
                          ? selectedCommunicationBreakdown.efficiency_deduction.score
                          : '—'}
                        ; range -2 to 0)
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{selectedCommunicationBreakdown.efficiency_deduction?.feedback || '—'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      CAUs: {selectedCommunicationBreakdown.efficiency_deduction?.cau_count ?? '—'} • Difficulty:{' '}
                      {selectedCommunicationBreakdown.efficiency_deduction?.case_difficulty ?? '—'}
                    </p>
                  </div>
                </div>
              </article>
              <article className="rounded-lg border border-slate-200 p-3 md:col-span-2">
                <h4 className="text-sm font-semibold text-slate-900">Medical Decision Making Breakdown</h4>
                <div className="mt-2 grid gap-3 md:grid-cols-3 text-sm text-slate-700">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="font-medium text-slate-900">
                      Labs/Orders Quality
                      <span className="ml-2 text-slate-500">
                        ({typeof selectedMdmBreakdown.labs_orders_quality?.score === 'number'
                          ? selectedMdmBreakdown.labs_orders_quality.score
                          : '—'}
                        /3)
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{selectedMdmBreakdown.labs_orders_quality?.feedback || '—'}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="font-medium text-slate-900">
                      Progress Note Thought Process
                      <span className="ml-2 text-slate-500">
                        ({typeof selectedMdmBreakdown.note_thought_process?.score === 'number'
                          ? selectedMdmBreakdown.note_thought_process.score
                          : '—'}
                        /2)
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{selectedMdmBreakdown.note_thought_process?.feedback || '—'}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="font-medium text-slate-900">
                      Safety Deduction
                      <span className="ml-2 text-slate-500">
                        ({typeof selectedMdmBreakdown.safety_deduction?.score === 'number'
                          ? selectedMdmBreakdown.safety_deduction.score
                          : '—'}
                        ; range -2 to 0)
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{selectedMdmBreakdown.safety_deduction?.feedback || '—'}</p>
                  </div>
                </div>
              </article>
              <article className="rounded-lg border border-slate-200 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Learning Objectives</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {selectedAssignment.learningObjectives || '—'}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 p-3 md:col-span-2">
                <h4 className="text-sm font-semibold text-slate-900">Narrative Feedback</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {asLegacyFeedback(selectedAssignment.nurseFeedback).summary || '—'}
                </p>
              </article>
              <article className="rounded-lg border border-slate-200 p-3 md:col-span-2">
                <h4 className="text-sm font-semibold text-slate-900">Recommendations</h4>
                {asLegacyFeedback(selectedAssignment.nurseFeedback).recommendations?.length ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                    {asLegacyFeedback(selectedAssignment.nurseFeedback).recommendations?.map((item, index) => (
                      <li key={`${selectedAssignment.id}-rec-${index}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-700">—</p>
                )}
              </article>
              <article className="rounded-lg border border-slate-200 p-3 md:col-span-2">
                <h4 className="text-sm font-semibold text-slate-900">Student Progress Note</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {selectedAssignment.studentProgressNote || '—'}
                </p>
              </article>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
