import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import Navbar from '../components/Navbar';
import AssignmentFeedback from '../components/AssignmentFeedback';
import type { Database } from '../lib/database.types';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room: Database['public']['Tables']['rooms']['Row'] & {
    specialty?: {
      name: string;
    };
  };
};

export default function StudentDashboard() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);

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
            *,
            specialty:specialty_id (name)
          )
        `)
        .eq('student_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAssignments(data || []);
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

  const completedAssignments = assignments.filter(a => a.status === 'completed');

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <h2 className="text-2xl font-bold text-gray-900">My Performance</h2>
          <p className="mt-2 text-sm text-gray-700">
            View feedback and performance evaluations for your completed assignments
          </p>
        </div>

        <div className="mt-4">
          <div className="bg-white shadow rounded-lg divide-y divide-gray-200">
            {completedAssignments.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No completed assignments yet
              </div>
            ) : (
              completedAssignments.map((assignment) => (
                <div key={assignment.id} className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">
                        Room {assignment.room.room_number}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {assignment.room.specialty?.name || 'General Practice'}
                        {` • Completed ${new Date(assignment.updated_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedAssignment(
                        selectedAssignment?.id === assignment.id ? null : assignment
                      )}
                      className="text-sm text-blue-600 hover:text-blue-900"
                    >
                      {selectedAssignment?.id === assignment.id ? 'Hide Feedback' : 'View Feedback'}
                    </button>
                  </div>
                  
                  {selectedAssignment?.id === assignment.id && (
                    <AssignmentFeedback assignment={assignment} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 