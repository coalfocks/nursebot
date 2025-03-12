import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import Navbar from '../components/Navbar';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, UserPlus, Search, Filter, Activity, CheckSquare, XCircle, Clock, Edit, Plus } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type Room = Database['public']['Tables']['rooms']['Row'] & {
  specialty: {
    name: string;
  } | null;
};
type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room: Room;
  student: Profile;
};

export default function AdminDashboard() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Profile[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'assignments' | 'assign-room'>('assignments');
  
  // Assignment form state
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>('');
  const [assignmentError, setAssignmentError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignmentSuccess, setAssignmentSuccess] = useState(false);

  useEffect(() => {
    if (!user || !profile?.is_admin) {
      navigate('/dashboard');
      return;
    }
    
    fetchData();
  }, [user, profile, navigate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchStudents(),
        fetchRooms(),
        fetchAssignments()
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async () => {
    // Only allow fetching students if user is admin
    if (!profile?.is_admin) {
      console.error('Unauthorized: Only admins can fetch student data');
      navigate('/dashboard');
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_admin', false)
      .order('full_name');
    
    if (error) throw error;
    setStudents(data || []);
  };

  const fetchRooms = async () => {
    const { data, error } = await supabase
      .from('rooms')
      .select(`
        *,
        specialty:specialty_id (
          name
        )
      `)
      .eq('is_active', true)
      .order('room_number');
    
    if (error) throw error;
    setRooms(data as Room[] || []);
  };

  const fetchAssignments = async () => {
    const { data, error } = await supabase
      .from('student_room_assignments')
      .select(`
        *,
        room:room_id (
          *,
          specialty:specialty_id (
            name
          )
        ),
        student:student_id (
          *
        )
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    setAssignments(data as Assignment[] || []);
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId || !selectedRoomId || !dueDate || !user) {
      setAssignmentError('Please fill in all fields');
      return;
    }

    setIsSubmitting(true);
    setAssignmentError('');
    setAssignmentSuccess(false);

    try {
      const { error } = await supabase
        .from('student_room_assignments')
        .insert([
          {
            student_id: selectedStudentId,
            room_id: selectedRoomId,
            assigned_by: user.id,
            due_date: new Date(dueDate).toISOString(),
            effective_date: effectiveDate ? new Date(effectiveDate).toISOString() : null,
          },
        ]);

      if (error) throw error;

      setAssignmentSuccess(true);
      setSelectedStudentId('');
      setSelectedRoomId(null);
      setDueDate('');
      setEffectiveDate('');
      await fetchAssignments();
    } catch (error: any) {
      setAssignmentError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredAssignments = assignments.filter((assignment) => {
    const matchesSearch =
      assignment.student.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      assignment.room.room_number.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus =
      statusFilter === 'all' || assignment.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

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
        <div className="px-4 sm:px-0">
          <div className="sm:flex sm:items-center">
            <div className="sm:flex-auto">
              <h2 className="text-2xl font-bold text-gray-900">Room Assignments</h2>
              <p className="mt-2 text-sm text-gray-700">
                Manage student assignments to patient rooms
              </p>
            </div>
            <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none space-x-4">
              <Link
                to="/admin/rooms"
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto"
              >
                Manage Rooms
              </Link>
              <button
                type="button"
                onClick={() => setActiveTab('assign-room')}
                className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                New Assignment
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="sm:hidden">
            <select
              id="tabs"
              name="tabs"
              className="block w-full rounded-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as 'assignments' | 'assign-room')}
            >
              <option value="assignments">Current Assignments</option>
              <option value="assign-room">Assign Room</option>
            </select>
          </div>
          <div className="hidden sm:block">
            <nav className="flex space-x-4" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('assignments')}
                className={`${
                  activeTab === 'assignments'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                } px-3 py-2 font-medium text-sm rounded-md`}
              >
                Current Assignments
              </button>
              <button
                onClick={() => setActiveTab('assign-room')}
                className={`${
                  activeTab === 'assign-room'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                } px-3 py-2 font-medium text-sm rounded-md`}
              >
                Assign Room
              </button>
            </nav>
          </div>
        </div>

        <div className="mt-4">
          {activeTab === 'assignments' ? (
            <div className="bg-white shadow rounded-lg">
              <div className="p-4 border-b border-gray-200 sm:flex sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-xs">
                  <input
                    type="text"
                    placeholder="Search assignments..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                  <Search className="absolute right-3 top-2 h-5 w-5 text-gray-400" />
                </div>
                <div className="mt-3 sm:mt-0 sm:ml-4">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  >
                    <option value="all">All Status</option>
                    <option value="assigned">Assigned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>

              <ul role="list" className="divide-y divide-gray-200">
                {filteredAssignments.map((assignment) => (
                  <li key={assignment.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <UserPlus className="h-8 w-8 text-gray-400" />
                          </div>
                          <div className="ml-4">
                            <h3 className="text-sm font-medium text-gray-900">
                              {assignment.student.full_name}
                            </h3>
                            <p className="text-sm text-gray-500">
                              Room {assignment.room.room_number} - {assignment.room.specialty?.name}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center">
                          {assignment.status === 'completed' ? (
                            <div className="flex items-center">
                              <CheckSquare className="h-5 w-5 text-green-500" />
                              <span className="ml-2 text-sm text-gray-500">
                                Completed
                                {assignment.completion_token_matched && (
                                  <span className="ml-1 text-xs text-green-600">(Token Matched)</span>
                                )}
                              </span>
                            </div>
                          ) : assignment.status === 'in_progress' ? (
                            <div className="flex items-center">
                              <Activity className="h-5 w-5 text-blue-500" />
                              <span className="ml-2 text-sm text-gray-500">In Progress</span>
                            </div>
                          ) : (
                            <div className="flex items-center">
                              <Clock className="h-5 w-5 text-gray-400" />
                              <span className="ml-2 text-sm text-gray-500">Assigned</span>
                            </div>
                          )}
                        </div>
                        <Link
                          to={`/assignments/${assignment.id}`}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          <Edit className="h-5 w-5" />
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="bg-white shadow rounded-lg p-4">
              <form onSubmit={handleAssign} className="space-y-4">
                {assignmentError && (
                  <div className="bg-red-50 border-l-4 border-red-400 p-4">
                    <div className="flex">
                      <div className="ml-3">
                        <p className="text-sm text-red-700">{assignmentError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {assignmentSuccess && (
                  <div className="bg-green-50 border-l-4 border-green-400 p-4">
                    <div className="flex">
                      <div className="ml-3">
                        <p className="text-sm text-green-700">
                          Room assigned successfully!
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="student" className="block text-sm font-medium text-gray-700">
                    Student
                  </label>
                  <select
                    id="student"
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  >
                    <option value="">Select a student</option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.full_name} (Year {student.study_year})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="room" className="block text-sm font-medium text-gray-700">
                    Room
                  </label>
                  <select
                    id="room"
                    value={selectedRoomId || ''}
                    onChange={(e) => setSelectedRoomId(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  >
                    <option value="">Select a room</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        Room {room.room_number} - {room.specialty?.name || 'No specialty'} ({room.difficulty_level})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700">
                    Due Date
                  </label>
                  <input
                    type="datetime-local"
                    id="dueDate"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </p>
                </div>

                <div>
                  <label htmlFor="effectiveDate" className="block text-sm font-medium text-gray-700">
                    Effective Date
                  </label>
                  <input
                    type="datetime-local"
                    id="effectiveDate"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    If set, the case will be automatically marked as complete 1 hour after this time.
                    <span className="block mt-1">
                      Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </span>
                  </p>
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Assigning...
                      </>
                    ) : (
                      'Assign Room'
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}