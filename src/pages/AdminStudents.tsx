import { useEffect, useMemo, useState } from 'react';
import { Loader2, Users, GraduationCap, TrendingUp, Filter, Search, BookOpen } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { Link } from 'react-router-dom';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type AssignmentRow = Database['public']['Tables']['student_room_assignments']['Row'];
type StudentSummary = {
  profile: ProfileRow;
  assignments: AssignmentRow[];
  averageScore: number | null;
  completedCount: number;
  activeCount: number;
};

const STUDY_YEARS = [1, 2, 3, 4, 5, 6];

export default function AdminStudents() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [yearFilter, setYearFilter] = useState<'all' | number>('all');
  const [performanceFilter, setPerformanceFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  useEffect(() => {
    let isMounted = true;

    const loadStudents = async () => {
      setLoading(true);
      setError(null);
      try {
        const [{ data: profileRows, error: profileError }, { data: assignmentRows, error: assignmentError }] =
          await Promise.all([
            supabase
              .from('profiles')
              .select('id, full_name, study_year, specialization_interest, phone_number, sms_consent, created_at')
              .eq('is_admin', false)
              .order('full_name'),
            supabase
              .from('student_room_assignments')
              .select('id, student_id, status, grade, nurse_feedback, created_at, completed_at'),
          ]);

        if (profileError) throw profileError;
        if (assignmentError) throw assignmentError;

        const assignmentsByStudent = new Map<string, AssignmentRow[]>();
        (assignmentRows as AssignmentRow[] | null)?.forEach((assignment) => {
          const list = assignmentsByStudent.get(assignment.student_id) ?? [];
          list.push(assignment);
          assignmentsByStudent.set(assignment.student_id, list);
        });

        const summaries: StudentSummary[] = (profileRows as ProfileRow[] | null)?.map((profile) => {
          const studentAssignments = assignmentsByStudent.get(profile.id) ?? [];
          const completedAssignments = studentAssignments.filter((assignment) => assignment.status === 'completed');
          const activeAssignments = studentAssignments.filter((assignment) => assignment.status !== 'completed');

          const scores = completedAssignments
            .map((assignment) => {
              const feedback = assignment.nurse_feedback as AssignmentRow['nurse_feedback'];
              if (feedback && typeof feedback.overall_score === 'number') {
                return feedback.overall_score;
              }
              if (typeof assignment.grade === 'number') {
                return assignment.grade / 20; // convert percentage (0-100) to 0-5 scale
              }
              return null;
            })
            .filter((value): value is number => value !== null);

          const averageScore = scores.length
            ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2))
            : null;

          return {
            profile,
            assignments: studentAssignments,
            averageScore,
            completedCount: completedAssignments.length,
            activeCount: activeAssignments.length,
          };
        }) ?? [];

        if (isMounted) {
          setStudents(summaries);
        }
      } catch (err) {
        console.error('Failed to load students', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unable to load students');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadStudents();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return students.filter((student) => {
      const { profile, averageScore } = student;
      const matchesSearch =
        term === '' ||
        profile.full_name.toLowerCase().includes(term) ||
        profile.specialization_interest?.toLowerCase().includes(term);

      const matchesYear = yearFilter === 'all' || profile.study_year === yearFilter;
      const matchesPerformance =
        performanceFilter === 'all' ||
        (performanceFilter === 'high' && (averageScore ?? 0) >= 4) ||
        (performanceFilter === 'medium' && (averageScore ?? 0) >= 2.5 && (averageScore ?? 0) < 4) ||
        (performanceFilter === 'low' && (averageScore ?? 5) < 2.5);

      return matchesSearch && matchesYear && matchesPerformance;
    });
  }, [students, searchTerm, yearFilter, performanceFilter]);

  const stats = useMemo(() => {
    if (students.length === 0) {
      return {
        totalStudents: 0,
        activeAssignments: 0,
        completedAssignments: 0,
        averageScore: null as number | null,
      };
    }

    const totalStudents = students.length;
    let activeAssignments = 0;
    let completedAssignments = 0;
    const scoreValues: number[] = [];

    students.forEach((student) => {
      activeAssignments += student.activeCount;
      completedAssignments += student.completedCount;
      if (typeof student.averageScore === 'number') {
        scoreValues.push(student.averageScore);
      }
    });

    const averageScore = scoreValues.length
      ? Number((scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length).toFixed(2))
      : null;

    return { totalStudents, activeAssignments, completedAssignments, averageScore };
  }, [students]);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex h-full items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="px-6 py-10">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            {error}
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="px-6 py-6 space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Student Management</h1>
            <p className="text-sm text-slate-500">Track student progress, performance, and assignments across schools.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex items-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Filter className="mr-2 h-4 w-4" />
              Advanced Filters
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
              onClick={() => alert('Student creation flow coming soon')}
            >
              Add Student
            </button>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Total Students</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.totalStudents}</p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <Users className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">All non-admin profiles across schools</p>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Active Assignments</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.activeAssignments}</p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <BookOpen className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Assignments in assigned or in-progress states</p>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Completed Assignments</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.completedAssignments}</p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <GraduationCap className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Completed simulations in the last cycle</p>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Average Score</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {stats.averageScore !== null ? stats.averageScore.toFixed(1) : '—'}
                </p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                <TrendingUp className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Average overall feedback score (0-5)</p>
          </article>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-4 border-b border-slate-100 pb-4">
            <div className="relative flex-1 min-w-[220px]">
              <input
                type="search"
                placeholder="Search by name or specialization..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            </div>

            <select
              value={yearFilter}
              onChange={(event) => {
                const value = event.target.value === 'all' ? 'all' : Number(event.target.value) as 'all' | number;
                setYearFilter(value);
              }}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Years</option>
              {STUDY_YEARS.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </select>

            <select
              value={performanceFilter}
              onChange={(event) => setPerformanceFilter(event.target.value as 'all' | 'high' | 'medium' | 'low')}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Performance</option>
              <option value="high">High (≥ 4.0)</option>
              <option value="medium">Medium (2.5 - 3.9)</option>
              <option value="low">Low (&lt; 2.5)</option>
            </select>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Year</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Avg. Score</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {filteredStudents.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                      No students match the current filters.
                    </td>
                  </tr>
                )}

                {filteredStudents.map((student) => (
                  <tr key={student.profile.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/students/${student.profile.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {student.profile.full_name}
                      </Link>
                      {student.profile.specialization_interest && (
                        <div className="text-xs text-slate-400">{student.profile.specialization_interest}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">Year {student.profile.study_year}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{student.activeCount}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{student.completedCount}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                      {student.averageScore !== null ? student.averageScore.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <Link
                          to={`/students/${student.profile.id}`}
                          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100"
                        >
                          View Assignments
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
