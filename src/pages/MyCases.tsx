import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import Navbar from '../components/Navbar';
import AdminLayout from '../components/admin/AdminLayout';
import { Loader2, Clock, Book, CheckCircle, ArrowRight, AlertCircle } from 'lucide-react';
import type { Database } from '../lib/database.types';
import { hasAdminAccess } from '../lib/roles';
import { fetchSpecialtiesForRoom } from '../lib/roomHelpers';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room: Database['public']['Tables']['rooms']['Row'] & {
    specialties?: Database['public']['Tables']['specialties']['Row'][];
  };
};

export default function MyCases() {
  const { user, profile } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [activeTab, setActiveTab] = useState<'assigned' | 'completed'>('assigned');

  useEffect(() => {
    if (user) {
      fetchAssignments();
    }
  }, [user]);

  const fetchAssignments = async () => {
    try {
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('student_room_assignments')
        .select(`
          *,
          room:room_id (
            *
          )
        `)
        .eq('student_id', user?.id)
        .or(`effective_date.is.null,effective_date.lte.${now}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch specialties for each room
      const assignmentsWithSpecialties = await Promise.all(
        (data || []).map(async (assignment) => ({
          ...assignment,
          room: {
            ...assignment.room,
            specialties: await fetchSpecialtiesForRoom(assignment.room),
          },
        }))
      );

      setAssignments(assignmentsWithSpecialties);
    } catch (error) {
      console.error('Error fetching assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'assigned':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <Clock className="w-3 h-3 mr-1" />
            Assigned
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <Book className="w-3 h-3 mr-1" />
            In Progress
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completed
          </span>
        );
      case 'bedside':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Bedside
          </span>
        );
      default:
        return null;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'No due date';
    const date = new Date(dateString);
    const formattedDate = date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${formattedDate} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
  };

  // Filter assignments based on active tab
  const filteredAssignments = assignments.filter(assignment => {
    // For completed assignments, show all of them
    if (activeTab === 'completed') {
      return assignment.status === 'completed';
    }
    
    // For active assignments, only show those that:
    // 1. Have status 'assigned' or 'in_progress'
    // 2. Have an effective_date that has passed (or is null)
    const now = new Date();
    const effectiveDate = assignment.effective_date ? new Date(assignment.effective_date) : null;

    return ['assigned', 'in_progress', 'bedside'].includes(assignment.status) && 
           (!effectiveDate || effectiveDate <= now);
  });

  const loaderContent = (
    <div className="flex h-full items-center justify-center py-24">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  );

  const pageContent = (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My Patients</h1>
        </div>

        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('assigned')}
                className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                  activeTab === 'assigned'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Active Conversations
              </button>
              <button
                onClick={() => setActiveTab('completed')}
                className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                  activeTab === 'completed'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Completed Conversations
              </button>
            </nav>
          </div>

          {filteredAssignments.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No {activeTab} assignments found.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {filteredAssignments.map((assignment) => (
                <li key={assignment.id} className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <h3 className="text-lg font-medium text-gray-900 mr-3">
                          Room {assignment.room.room_number}
                        </h3>
                        {getStatusBadge(assignment.status)}
                      </div>
                      {assignment.status === 'in_progress' && (
                        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                          <div className="flex items-center">
                            <AlertCircle className="w-4 h-4 text-red-400 mr-2" />
                            <span className="text-sm font-medium text-red-800">Urgent Response Needed</span>
                          </div>
                        </div>
                      )}
                      <p className="mt-2 text-sm text-gray-500">
                        {assignment.room.specialties && assignment.room.specialties.length > 0
                          ? assignment.room.specialties.map(s => s.name).join(', ')
                          : 'General Practice'}
                      </p>

                      {assignment.due_date && (
                        <p className="mt-2 text-sm text-gray-600">
                          <span className="font-medium">Due:</span> {formatDate(assignment.due_date)}
                        </p>
                      )}

                      {assignment.effective_date && (
                        <p className="mt-2 text-sm text-gray-600">
                          <span className="font-medium">Effective:</span> {formatDate(assignment.effective_date)}
                          <span className="ml-2 text-xs text-gray-500">(Auto-completes after 1 hour)</span>
                        </p>
                      )}

                    </div>
                    <div className="ml-6 text-sm text-gray-500">
                      <p className="font-medium text-gray-700">Assigned</p>
                      <p>{formatDate(assignment.created_at)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

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
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">My Patients</h1>
          </div>

          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="border-b border-gray-200">
              <nav className="flex -mb-px">
                <button
                  onClick={() => setActiveTab('assigned')}
                  className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                    activeTab === 'assigned'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Active Conversations
                </button>
                <button
                  onClick={() => setActiveTab('completed')}
                  className={`whitespace-nowrap py-4 px-6 border-b-2 font-medium text-sm ${
                    activeTab === 'completed'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Completed Conversations
                </button>
              </nav>
            </div>

            {filteredAssignments.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No {activeTab} assignments found.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {filteredAssignments.map((assignment) => (
                  <li key={assignment.id} className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center">
                          <h3 className="text-lg font-medium text-gray-900 mr-3">
                            Room {assignment.room.room_number}
                          </h3>
                          {getStatusBadge(assignment.status)}
                        </div>
                        {assignment.status === 'in_progress' && (
                          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
                            <div className="flex items-center">
                              <AlertCircle className="w-4 h-4 text-red-400 mr-2" />
                              <span className="text-sm font-medium text-red-800">Urgent Response Needed</span>
                            </div>
                          </div>
                        )}
                        <p className="mt-2 text-sm text-gray-500">
                          {assignment.room.specialty?.name || 'General Practice'}
                        </p>
                        
                        {assignment.due_date && (
                          <p className="mt-2 text-sm text-gray-600">
                            <span className="font-medium">Due:</span> {formatDate(assignment.due_date)}
                          </p>
                        )}
                        
                        {assignment.effective_date && (
                          <p className="mt-2 text-sm text-gray-600">
                            <span className="font-medium">Effective:</span> {formatDate(assignment.effective_date)}
                            <span className="ml-2 text-xs text-gray-500">(Auto-completes after 1 hour)</span>
                          </p>
                        )}

                      </div>

                      <div className="ml-4">
                        <Link
                          to={`/assignment/${assignment.id}`}
                          className={`inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md ${
                            activeTab === 'assigned' && assignment.effective_date && new Date(assignment.effective_date) > new Date()
                              ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                              : 'text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                          }`}
                          onClick={(e) => {
                            if (activeTab === 'assigned' && assignment.effective_date && new Date(assignment.effective_date) > new Date()) {
                              e.preventDefault();
                            }
                          }}
                        >
                          {activeTab === 'assigned' ? 'Enter Room' : 'View Details'}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    if (hasAdminAccess(profile)) {
      return <AdminLayout>{loaderContent}</AdminLayout>;
    }
    return (
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  if (hasAdminAccess(profile)) {
    return <AdminLayout>{pageContent}</AdminLayout>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      {pageContent}
    </div>
  );
}
