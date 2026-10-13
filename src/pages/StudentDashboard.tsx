import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Loader2, MessageSquare } from 'lucide-react';
import Navbar from '../components/Navbar';
import type { Database } from '../lib/database.types';
import { fetchSpecialtiesForRoom } from '../lib/roomHelpers';
import { resolveAssignmentRoom } from '../lib/assignmentBaseline';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room: Database['public']['Tables']['rooms']['Row'] & {
    specialties?: Database['public']['Tables']['specialties']['Row'][];
  };
};

export default function StudentDashboard() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  useEffect(() => {
    if (!user) return;
    fetchAssignments();
  }, [user]);

  const fetchAssignments = async () => {
    try {
      const { data, error } = await supabase
        .from('student_room_assignments')
        .select(`
          *,
          room:room_id (
            *
          )
        `)
        .eq('student_id', user?.id)
        .in('status', ['assigned', 'in_progress'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch specialties for each room
      const assignmentsWithSpecialties = await Promise.all(
        (data || []).map(async (assignment) => {
          const resolvedRoom = resolveAssignmentRoom(assignment.room, assignment.scenario_baseline);

          return {
            ...assignment,
            room: {
              ...resolvedRoom,
              specialties: await fetchSpecialtiesForRoom(resolvedRoom),
            },
          };
        })
      );

      setAssignments(assignmentsWithSpecialties);
    } catch (error) {
      console.error('Error fetching assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="mx-auto w-full max-w-5xl p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Rooms</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((assignment) => (
            <Link
              key={assignment.id}
              to={`/assignment/${assignment.id}`}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Room {assignment.room.room_number}</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {assignment.room.specialties && assignment.room.specialties.length > 0
                      ? assignment.room.specialties.map(s => s.name).join(', ')
                      : 'General Practice'}
                  </p>
                </div>
                <MessageSquare className="h-5 w-5 text-blue-600" aria-hidden="true" />
              </div>
              <span className="mt-4 inline-block text-sm font-medium text-blue-700">Open nurse chat</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
