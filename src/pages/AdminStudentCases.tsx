import { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { useAuthStore } from '../stores/authStore';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import { fetchSpecialtiesForRoom } from '../lib/roomHelpers';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type AssignmentRow = Database['public']['Tables']['student_room_assignments']['Row'];

type AssignmentWithRoom = AssignmentRow & {
  room: Database['public']['Tables']['rooms']['Row'] & {
    specialties?: Database['public']['Tables']['specialties']['Row'][];
  } | null;
};

export default function AdminStudentCases() {
  const { studentId } = useParams<{ studentId: string }>();
  const { profile, activeSchoolId } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [student, setStudent] = useState<ProfileRow | null>(null);
  const [assignments, setAssignments] = useState<AssignmentWithRoom[]>([]);
  const hasAdmin = hasAdminAccess(profile);
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;

  useEffect(() => {
    if (!studentId) return;

    let isMounted = true;

    const loadStudent = async () => {
      if (!hasAdmin) return;
      setLoading(true);
      setError(null);
      try {
        let studentQuery = supabase
          .from('profiles')
          .select('*')
          .eq('id', studentId)
          .eq('role', 'student');

        if (scopedSchoolId) {
          studentQuery = studentQuery.eq('school_id', scopedSchoolId);
        }

        let assignmentQuery = supabase
          .from('student_room_assignments')
          .select(`
            *,
            room:room_id (
              *
            )
          `)
          .eq('student_id', studentId)
          .order('created_at', { ascending: false });

        if (scopedSchoolId) {
          assignmentQuery = assignmentQuery.eq('school_id', scopedSchoolId);
        }

        const [{ data: studentRow, error: studentError }, { data: assignmentRows, error: assignmentError }] = await Promise.all([
          studentQuery.single(),
          assignmentQuery,
        ]);

        if (studentError) throw studentError;
        if (assignmentError) throw assignmentError;

        // Fetch specialties for each assignment's room
        const assignmentsWithSpecialties = await Promise.all(
          (assignmentRows ?? []).map(async (assignment) => ({
            ...assignment,
            room: assignment.room ? {
              ...assignment.room,
              specialties: await fetchSpecialtiesForRoom(assignment.room),
            } : null,
          }))
        );

        if (isMounted) {
          setStudent(studentRow as ProfileRow);
          setAssignments(assignmentsWithSpecialties as AssignmentWithRoom[]);
        }
      } catch (err) {
        console.error('Failed to load student assignments', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unable to load student assignments');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadStudent();

    return () => {
      isMounted = false;
    };
  }, [studentId, hasAdmin, scopedSchoolId]);

  if (!hasAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex h-full items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  if (error || !student) {
    return (
      <AdminLayout>
        <div className="px-6 py-10">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            {error ?? 'Student not found.'}
          </div>
          <div className="mt-4">
            <Link
              to="/cases"
              className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Students
            </Link>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const getStatusBadge = (status: AssignmentRow['status']) => {
    const base = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium';
    switch (status) {
      case 'completed':
        return <span className={`${base} bg-emerald-100 text-emerald-700`}>Completed</span>;
      case 'bedside':
        return <span className={`${base} bg-emerald-100 text-emerald-700`}>Completed</span>;
      case 'in_progress':
        return <span className={`${base} bg-amber-100 text-amber-700`}>In Progress</span>;
      default:
        return <span className={`${base} bg-slate-100 text-slate-600`}>Assigned</span>;
    }
  };

  return (
    <AdminLayout>
      <div className="px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link
            to="/cases"
            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Students
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{student.full_name}</h1>
            <p className="text-sm text-slate-500">Year {student.study_year}</p>
          </div>
        </div>

        {assignments.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            This student does not have any assignments yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Window</th>
                  <th className="px-4 py-3">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((assignment) => {
                  const room = assignment.room;
                  return (
                    <tr key={assignment.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          Room {room?.room_number ?? '—'}
                        </div>
                        <div className="text-xs text-slate-500">
                          {room?.specialties && room.specialties.length > 0
                            ? room.specialties.map(s => s.name).join(', ')
                            : 'General Practice'}
                        </div>
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(assignment.status)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {assignment.window_start
                          ? `${new Date(assignment.window_start).toLocaleDateString()} - ${new Date(assignment.window_end).toLocaleDateString()}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {assignment.completed_at ? new Date(assignment.completed_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
