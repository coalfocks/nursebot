import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, AlertCircle, CheckCircle, Clock, Activity } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import AssignmentFeedback from '../components/AssignmentFeedback';
import { generateFeedback } from '../lib/feedbackService';
import type { Database } from '../lib/database.types';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  student: Database['public']['Tables']['profiles']['Row'];
  room: Database['public']['Tables']['rooms']['Row'] & {
    specialty?: {
      name: string;
    };
  };
};

export default function FeedbackManagement() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !profile?.is_admin) {
      navigate('/dashboard');
      return;
    }
    
    fetchAssignments();
  }, [user, profile, navigate]);

  const fetchAssignments = async () => {
    try {
      const { data, error } = await supabase
        .from('student_room_assignments')
        .select(`
          *,
          student:student_id (
            id,
            full_name,
            study_year,
            email
          ),
          room:room_id (
            id,
            room_number,
            specialty:specialty_id (
              name
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAssignments(data || []);
    } catch (error) {
      console.error('Error fetching assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRetryFeedback = async (assignmentId: string) => {
    if (processingIds.has(assignmentId)) return;

    setProcessingIds(new Set([...processingIds, assignmentId]));
    try {
      await generateFeedback(assignmentId);
      await fetchAssignments();
    } catch (error) {
      console.error('Error retrying feedback:', error);
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(assignmentId);
        return next;
      });
    }
  };

  const filteredAssignments = assignments.filter(assignment => {
    const matchesStatus = statusFilter === 'all' || assignment.feedback_status === statusFilter;
    const matchesSearch = searchTerm === '' || 
      assignment.student.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (assignment.student.email?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
      assignment.room.room_number.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex h-full items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0">
          <h2 className="text-2xl font-bold text-gray-900">Feedback Management</h2>
          <p className="mt-2 text-sm text-gray-700">
            Monitor and manage feedback generation for completed assignments
          </p>
        </div>

        <div className="mt-4">
          <div className="bg-white shadow rounded-lg">
            <div className="p-4 border-b border-gray-200 sm:flex sm:items-center sm:justify-between">
              <div className="flex-1 min-w-0">
                <div className="max-w-xs">
                  <label htmlFor="search" className="sr-only">Search</label>
                  <input
                    type="text"
                    id="search"
                    placeholder="Search by student, email, or room..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                </div>
              </div>
              <div className="mt-4 sm:mt-0 sm:ml-4">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>

            <ul role="list" className="divide-y divide-gray-200">
              {filteredAssignments.map((assignment) => (
                <li key={assignment.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">
                      {assignment.student.full_name}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Room {assignment.room.room_number}
                      {assignment.room.specialty?.name && ` - ${assignment.room.specialty.name}`}
                    </p>
                    {assignment.student.email && (
                      <p className="text-sm text-gray-500">{assignment.student.email}</p>
                    )}
                  </div>
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center">
                        {assignment.feedback_status === 'completed' ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : assignment.feedback_status === 'processing' ? (
                          <Activity className="h-5 w-5 text-blue-500" />
                        ) : assignment.feedback_status === 'failed' ? (
                          <AlertCircle className="h-5 w-5 text-red-500" />
                        ) : (
                          <Clock className="h-5 w-5 text-gray-400" />
                        )}
                        <span className="ml-2 text-sm text-gray-500 capitalize">
                          {assignment.feedback_status}
                        </span>
                      </div>
                      <button
                        onClick={() => setSelectedAssignment(
                          selectedAssignment?.id === assignment.id ? null : assignment
                        )}
                        className="text-sm text-blue-600 hover:text-blue-900"
                      >
                        {selectedAssignment?.id === assignment.id ? 'Hide' : 'View'}
                      </button>
                      {(assignment.feedback_status === 'failed' || assignment.feedback_status === 'pending') && (
                        <button
                          onClick={() => handleRetryFeedback(assignment.id)}
                          disabled={processingIds.has(assignment.id)}
                          className="inline-flex items-center text-sm text-blue-600 hover:text-blue-900 disabled:opacity-50"
                        >
                          <RefreshCw className={`h-4 w-4 mr-1 ${
                            processingIds.has(assignment.id) ? 'animate-spin' : ''
                          }`} />
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedAssignment?.id === assignment.id && (
                    <div className="mt-4">
                      <AssignmentFeedback
                        assignment={assignment}
                        onRetryFeedback={() => handleRetryFeedback(assignment.id)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
