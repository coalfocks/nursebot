import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, FileText, GraduationCap, School, TrendingUp, Users, Clock } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import StudentDashboard from './StudentDashboard';
import TestRooms from './TestRooms';
import type { Database } from '../lib/database.types';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import { hasAdminAccess, isSuperAdmin, isTestUser } from '../lib/roles';

type AssignmentRow = Database['public']['Tables']['student_room_assignments']['Row'];
type RoomRow = Database['public']['Tables']['rooms']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

type RecentAssignment = {
  id: string;
  status: AssignmentRow['status'];
  createdAt: string;
  grade: number | null;
  studentName: string;
  roomNumber: string;
  specialty?: string | null;
};

type DashboardStats = {
  studentCount: number;
  assignmentCount: number;
  completedAssignments: number;
  activeRoomCount: number;
  adminCount: number;
  averageScore: number | null;
};

const initialStats: DashboardStats = {
  studentCount: 0,
  assignmentCount: 0,
  completedAssignments: 0,
  activeRoomCount: 0,
  adminCount: 0,
  averageScore: null,
};

const formatStatusLabel = (status: AssignmentRow['status']) => {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in_progress':
      return 'In Progress';
    default:
      return 'Assigned';
  }
};

const statusBadgeClass = (status: AssignmentRow['status']) => {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700';
    case 'in_progress':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
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
  const [recentAssignments, setRecentAssignments] = useState<RecentAssignment[]>([]);
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

        let assignmentQuery = supabase
          .from('student_room_assignments')
          .select('id', { count: 'exact', head: true });
        if (scopedSchoolId) {
          assignmentQuery = assignmentQuery.eq('school_id', scopedSchoolId);
        }

        let completedQuery = supabase
          .from('student_room_assignments')
          .select('id', { count: 'exact', head: true })
          .in('status', ['completed', 'bedside']);
        if (scopedSchoolId) {
          completedQuery = completedQuery.eq('school_id', scopedSchoolId);
        }

        let roomsQuery = supabase
          .from('rooms')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true);
        if (scopedSchoolId) {
          roomsQuery = roomsQuery.eq('school_id', scopedSchoolId);
        }

        let gradeQuery = supabase
          .from('student_room_assignments')
          .select('grade, nurse_feedback');
        if (scopedSchoolId) {
          gradeQuery = gradeQuery.eq('school_id', scopedSchoolId);
        }

        let recentQuery = supabase
          .from('student_room_assignments')
          .select(
            `id, status, grade, created_at,
             room:room_id ( room_number, specialty:specialty_id ( name ) ),
             student:student_id ( full_name )`
          )
          .order('created_at', { ascending: false })
          .limit(6);
        if (scopedSchoolId) {
          recentQuery = recentQuery.eq('school_id', scopedSchoolId);
        }

        const [
          studentResult,
          adminResult,
          assignmentResult,
          completedResult,
          roomsResult,
          gradeResult,
          recentResult,
        ] = await Promise.all([
          studentQuery,
          adminQuery,
          assignmentQuery,
          completedQuery,
          roomsQuery,
          gradeQuery,
          recentQuery,
        ]);

        if (!isMounted) return;

        if (studentResult.error) throw studentResult.error;
        if (adminResult.error) throw adminResult.error;
        if (assignmentResult.error) throw assignmentResult.error;
        if (completedResult.error) throw completedResult.error;
        if (roomsResult.error) throw roomsResult.error;
        if (gradeResult.error) throw gradeResult.error;
        if (recentResult.error) throw recentResult.error;

        const gradeRows = (gradeResult.data ?? []) as Array<Pick<AssignmentRow, 'grade' | 'nurse_feedback'>>;
        const scoreValues = gradeRows
          .map((row) => {
            if (typeof row.grade === 'number') return row.grade;
            const feedback = row.nurse_feedback as AssignmentRow['nurse_feedback'];
            if (feedback && typeof feedback.overall_score === 'number') {
              return feedback.overall_score;
            }
            return null;
          })
          .filter((value): value is number => value !== null);

        const averageScore = scoreValues.length
          ? Number((scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length).toFixed(1))
          : null;

        const recentRows = (recentResult.data ?? []) as Array<
          Pick<AssignmentRow, 'id' | 'status' | 'grade' | 'created_at'> & {
            room: Pick<RoomRow, 'room_number'> & { specialty: { name: string | null } | null } | null;
            student: Pick<ProfileRow, 'full_name'> | null;
          }
        >;

        setStats({
          studentCount: studentResult.count ?? 0,
          adminCount: adminResult.count ?? 0,
          assignmentCount: assignmentResult.count ?? 0,
          completedAssignments: completedResult.count ?? 0,
          activeRoomCount: roomsResult.count ?? 0,
          averageScore,
        });

        setRecentAssignments(
          recentRows.map((row) => ({
            id: row.id,
            status: row.status,
            grade: row.grade,
            createdAt: row.created_at,
            studentName: row.student?.full_name ?? 'Unassigned',
            roomNumber: row.room?.room_number ?? '—',
            specialty: row.room?.specialty?.name ?? null,
          }))
        );
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
                    description: 'Latest recorded average',
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

                <section className="grid gap-6 lg:grid-cols-3">
                  <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">Recent Case Assignments</h3>
                        <p className="text-sm text-slate-500">Latest activity across cohorts</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate('/admin/assignments')}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        View all
                      </button>
                    </div>
                    <div className="mt-6 space-y-4">
                      {recentAssignments.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                          No assignments have been created yet.
                        </p>
                      ) : (
                        recentAssignments.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-4 py-3">
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                                {item.studentName
                                  .split(' ')
                                  .map((part) => part[0])
                                  .join('')
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{item.studentName}</p>
                                <p className="text-xs text-slate-500">
                                  Room {item.roomNumber}
                                  {item.specialty ? ` • ${item.specialty}` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(item.status)}`}>
                                {formatStatusLabel(item.status)}
                              </span>
                              {typeof item.grade === 'number' && (
                                <span className="text-sm font-semibold text-slate-900">{item.grade.toFixed(1)}</span>
                              )}
                              <div className="flex items-center gap-1 text-xs text-slate-500">
                                <Clock className="h-3.5 w-3.5" />
                                {new Date(item.createdAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </article>

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
