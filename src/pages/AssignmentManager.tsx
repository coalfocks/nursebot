import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Plus, Search, MessageSquare, RefreshCw } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import type { Database } from '../lib/database.types';
import { useAuthStore } from '../stores/authStore';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  student: {
    id: string;
    full_name: string;
    study_year: number;
    email: string | null;
    school_id: string | null;
  };
  room: {
    id: number;
    room_number: string;
    specialty_id: string | null;
    difficulty_level: string | null;
    school_id: string;
  };
};

type Room = Database['public']['Tables']['rooms']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];
type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];

export default function AssignmentManager() {
  const { user, profile, activeSchoolId } = useAuthStore();
  const hasAdmin = hasAdminAccess(profile);
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Profile[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filters, setFilters] = useState({
    status: '',
    studentId: '',
    roomId: '',
    search: ''
  });
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>('');
  const [editingAssignment, setEditingAssignment] = useState<{
    id: string;
    effective_date: string;
    due_date: string | null;
  } | null>(null);
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedChatMessages, setSelectedChatMessages] = useState<ChatMessage[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [rerunningAssessments, setRerunningAssessments] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!hasAdmin) return;
    fetchData();
  }, [hasAdmin, scopedSchoolId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchAssignments(),
        fetchStudents(),
        fetchRooms()
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignments = async () => {
    let query = supabase
      .from('student_room_assignments')
      .select(`
        *,
        student:student_id (
          id,
          full_name,
          study_year,
          email,
          school_id
        ),
        room:room_id (
          id,
          room_number,
          specialty_id,
          difficulty_level,
          school_id
        )
      `)
      .order('created_at', { ascending: false });

    if (scopedSchoolId) {
      query = query.eq('school_id', scopedSchoolId);
    }

    const { data, error } = await query;

    if (error) throw error;
    setAssignments((data ?? []) as Assignment[]);
  };

  const fetchStudents = async () => {
    let query = supabase
      .from('profiles')
      .select('id, full_name, study_year, email, role, school_id')
      .eq('role', 'student')
      .order('full_name');

    if (scopedSchoolId) {
      query = query.eq('school_id', scopedSchoolId);
    }

    const { data, error } = await query;

    if (error) throw error;
    setStudents(data || []);
  };

  const fetchRooms = async () => {
    let query = supabase
      .from('rooms')
      .select('*')
      .order('room_number');

    if (scopedSchoolId) {
      query = query.eq('school_id', scopedSchoolId);
    }

    const { data, error } = await query;

    if (error) throw error;
    setRooms(data || []);
  };

  const handleAssign = async () => {
    if (!selectedRoom || !selectedStudent || !user || !effectiveDate) {
      alert('Please select a room, student, and effective date');
      return;
    }

    const selectedStudentProfile = students.find((student) => student.id === selectedStudent);
    const assignmentSchoolId = selectedStudentProfile?.school_id ?? scopedSchoolId;

    if (!assignmentSchoolId) {
      alert('Unable to determine school for this assignment. Please select a school scope first.');
      return;
    }

    try {
      // Convert effective date to UTC
      const effectiveDateTime = new Date(effectiveDate);
      const effectiveDateUTC = effectiveDateTime.toISOString();

      // Calculate default due date if not specified and convert to UTC
      let calculatedDueDate = dueDate;
      if (!calculatedDueDate) {
        const defaultDueDate = new Date(effectiveDateTime.getTime() + 60 * 60 * 1000);
        calculatedDueDate = defaultDueDate.toISOString();
      } else {
        calculatedDueDate = new Date(calculatedDueDate).toISOString();
      }

      const { error } = await supabase
        .from('student_room_assignments')
        .insert({
          student_id: selectedStudent,
          room_id: parseInt(selectedRoom),
          assigned_by: user.id,
          status: 'assigned',
          due_date: calculatedDueDate || null,
          effective_date: effectiveDateUTC || null,
          school_id: assignmentSchoolId,
        });

      if (error) throw error;

      setShowAssignModal(false);
      setSelectedStudent('');
      setStudentSearch('');
      setSelectedRoom('');
      setDueDate('');
      setEffectiveDate('');
      await fetchAssignments();
    } catch (error) {
      console.error('Error assigning case:', error);
      alert('Error assigning case. Please try again.');
    }
  };

  const handleDelete = async (assignmentId: string) => {
    if (!window.confirm('Are you sure you want to delete this assignment?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('student_room_assignments')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;
      await fetchAssignments();
    } catch (error) {
      console.error('Error deleting assignment:', error);
      alert('Error deleting assignment. Please try again.');
    }
  };

  const handleEdit = async () => {
    if (!editingAssignment) return;

    try {
      const { error } = await supabase
        .from('student_room_assignments')
        .update({
          effective_date: new Date(editingAssignment.effective_date).toISOString(),
          due_date: editingAssignment.due_date ? new Date(editingAssignment.due_date).toISOString() : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingAssignment.id);

      if (error) throw error;
      setEditingAssignment(null);
      await fetchAssignments();
    } catch (error) {
      console.error('Error updating assignment:', error);
      alert('Error updating assignment. Please try again.');
    }
  };

  const fetchChatMessages = async (assignmentId: string) => {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching chat messages:', error);
      return [];
    }
  };

  const handleViewChat = async (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    const messages = await fetchChatMessages(assignment.id);
    setSelectedChatMessages(messages);
    setShowChatModal(true);
  };

  const handleRerunAssessment = async (assignmentId: string) => {
    if (!window.confirm('Are you sure you want to rerun the assessment for this submission? This will regenerate the feedback and scores.')) {
      return;
    }

    setRerunningAssessments(prev => new Set(prev).add(assignmentId));

    try {
      console.log('Rerunning assessment for assignment:', assignmentId);
      
      const { data, error } = await supabase.functions.invoke('rerun-assessments', {
        body: { 
          assignment_ids: [assignmentId]
        }
      });

      if (error) {
        console.error('Error rerunning assessment:', error);
        throw error;
      }

      console.log('Assessment rerun response:', data);

      if (data?.success) {
        // Show success message
        alert(`Assessment rerun initiated successfully! ${data.message}`);
        
        // Refresh assignments to show updated status
        await fetchAssignments();
      } else {
        throw new Error(data?.error || 'Failed to rerun assessment');
      }
    } catch (error) {
      console.error('Error rerunning assessment:', error);
      alert(`Error rerunning assessment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRerunningAssessments(prev => {
        const newSet = new Set(prev);
        newSet.delete(assignmentId);
        return newSet;
      });
    }
  };

  const filteredStudents = students.filter((student) => {
    const term = studentSearch.toLowerCase();
    return (
      student.full_name.toLowerCase().includes(term) ||
      (student.email?.toLowerCase().includes(term) ?? false)
    );
  });

  const filteredAssignments = assignments.filter((assignment) => {
    if (filters.status && assignment.status !== filters.status) return false;
    if (filters.studentId && assignment.student_id !== filters.studentId) return false;
    if (filters.roomId && assignment.room_id.toString() !== filters.roomId) return false;
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      return (
        assignment.student.full_name.toLowerCase().includes(searchTerm) ||
        (assignment.student.email?.toLowerCase().includes(searchTerm) ?? false) ||
        assignment.room.room_number.toLowerCase().includes(searchTerm)
      );
    }
    return true;
  });

  const getStatusBadge = (status: string) => {
    const badges = {
      assigned: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800'
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badges[status as keyof typeof badges]}`}>
        {status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Not set';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!hasAdmin) {
    return <AdminLayout><div className="flex h-full items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div></AdminLayout>;
  }

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
        {/* Header */}
        <div className="px-4 sm:px-0 mb-8 space-y-4 sm:space-y-0 sm:flex sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Case Assignments</h1>
            <p className="mt-1 text-sm text-gray-600">Manage and track assignments for your selected school.</p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
            <SchoolScopeSelector className="sm:w-56" label="School scope" />
            <button
              onClick={() => setShowAssignModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Assign Cases
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white shadow rounded-lg mb-6">
          <div className="p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">All Status</option>
                  <option value="assigned">Assigned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Student</label>
                <select
                  value={filters.studentId}
                  onChange={(e) => setFilters({ ...filters, studentId: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">All Students</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.full_name}
                      {student.email ? ` (${student.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Room</label>
                <select
                  value={filters.roomId}
                  onChange={(e) => setFilters({ ...filters, roomId: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">All Rooms</option>
                  {rooms.map(room => (
                    <option key={room.id} value={room.id}>
                      Room {room.room_number}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Search</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Search by name, email, or room..."
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Assignments List */}
        <div className="bg-white shadow rounded-lg">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Student
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Room
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Progress
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAssignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {assignment.student.full_name}
                      </div>
                      <div className="text-sm text-gray-500">
                        Year {assignment.student.study_year}
                      </div>
                      {assignment.student.email && (
                        <div className="text-sm text-gray-500">{assignment.student.email}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        Room {assignment.room.room_number}
                      </div>
                      <div className="text-sm text-gray-500">
                        {assignment.room.difficulty_level || 'No difficulty set'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(assignment.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(assignment.due_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {assignment.nurse_feedback ? (
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">
                            Score: {assignment.nurse_feedback.overall_score}/5
                          </div>
                          <div className="text-gray-500">
                            Feedback provided
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">
                          No feedback yet
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="ml-4 flex space-x-2">
                        {new Date(assignment.effective_date || '') > new Date() && (
                          <>
                            <button
                              onClick={() => {
                                // Format dates for the datetime-local input
                                const effectiveDate = assignment.effective_date 
                                  ? new Date(assignment.effective_date).toISOString().slice(0, 16)
                                  : '';
                                const dueDate = assignment.due_date
                                  ? new Date(assignment.due_date).toISOString().slice(0, 16)
                                  : null;
                                
                                setEditingAssignment({
                                  id: assignment.id,
                                  effective_date: effectiveDate,
                                  due_date: dueDate
                                });
                              }}
                              className="inline-flex items-center px-3 py-2 border border-blue-300 shadow-sm text-sm leading-4 font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(assignment.id)}
                              className="inline-flex items-center px-3 py-2 border border-red-300 shadow-sm text-sm leading-4 font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {assignment.status === 'completed' && (
                          <>
                            <button
                              onClick={() => handleViewChat(assignment)}
                              className="inline-flex items-center px-3 py-2 border border-green-300 shadow-sm text-sm leading-4 font-medium rounded-md text-green-700 bg-white hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                            >
                              <MessageSquare className="w-4 h-4 mr-1" />
                              View Chat
                            </button>
                            <button
                              onClick={() => handleRerunAssessment(assignment.id)}
                              disabled={rerunningAssessments.has(assignment.id)}
                              className="inline-flex items-center px-3 py-2 border border-orange-300 shadow-sm text-sm leading-4 font-medium rounded-md text-orange-700 bg-white hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {rerunningAssessments.has(assignment.id) ? (
                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                              ) : (
                                <RefreshCw className="w-4 h-4 mr-1" />
                              )}
                              {rerunningAssessments.has(assignment.id) ? 'Rerunning...' : 'Rerun Assessment'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Assignment Modal */}
      {showAssignModal && (
        <div className="fixed z-10 inset-0 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Assign Case</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Select Room</label>
                    <select
                      value={selectedRoom}
                      onChange={(e) => setSelectedRoom(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="">Choose a room...</option>
                      {rooms.map(room => (
                        <option key={room.id} value={room.id}>
                          Room {room.room_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Search Students</label>
                    <div className="mt-1">
                      <input
                        type="text"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="Type to search students..."
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md">
                      {filteredStudents.map(student => (
                        <button
                          key={student.id}
                          type="button"
                          onClick={() => setSelectedStudent(student.id)}
                          className={`w-full text-left px-4 py-2 hover:bg-gray-50 focus:outline-none ${
                            selectedStudent === student.id ? 'bg-blue-50' : ''
                          }`}
                        >
                          <div className="font-medium text-gray-900">{student.full_name}</div>
                          <div className="text-sm text-gray-500">
                            Year {student.study_year}
                          </div>
                        </button>
                      ))}
                      {filteredStudents.length === 0 && (
                        <div className="px-4 py-2 text-sm text-gray-500">
                          No students found
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Effective Date <span className="text-red-500">*</span></label>
                    <input
                      type="datetime-local"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      required
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      When should this assignment become active? This is required.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Due Date (Optional)</label>
                    <input
                      type="datetime-local"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                <button
                  type="button"
                  onClick={handleAssign}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:col-start-2"
                >
                  Assign
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAssignModal(false);
                    setSelectedStudent('');
                    setStudentSearch('');
                    setSelectedRoom('');
                    setDueDate('');
                    setEffectiveDate('');
                  }}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:col-start-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Assignment Modal */}
      {editingAssignment && (
        <div className="fixed z-10 inset-0 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Edit Assignment</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Effective Date <span className="text-red-500">*</span></label>
                    <input
                      type="datetime-local"
                      value={editingAssignment.effective_date}
                      onChange={(e) => setEditingAssignment({
                        ...editingAssignment,
                        effective_date: e.target.value
                      })}
                      required
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Due Date (Optional)</label>
                    <input
                      type="datetime-local"
                      value={editingAssignment.due_date || ''}
                      onChange={(e) => setEditingAssignment({
                        ...editingAssignment,
                        due_date: e.target.value || null
                      })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                <button
                  type="button"
                  onClick={handleEdit}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:col-start-2 sm:text-sm"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => setEditingAssignment(null)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:col-start-1 sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Modal */}
      {showChatModal && selectedAssignment && (
        <div className="fixed z-10 inset-0 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full sm:p-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Chat History - {selectedAssignment.student.full_name} in Room {selectedAssignment.room.room_number}
                </h3>
                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                  {selectedChatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'student' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] p-4 rounded-lg ${
                          message.role === 'student'
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        <div className="flex items-center mb-1">
                          <span className="text-xs font-medium">
                            {message.role === 'student' ? 'Student' : 'Nurse'}
                          </span>
                          <span className="text-xs ml-2 opacity-75">
                            {new Date(message.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 sm:mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowChatModal(false);
                    setSelectedChatMessages([]);
                    setSelectedAssignment(null);
                  }}
                  className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
