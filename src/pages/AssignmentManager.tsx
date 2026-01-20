import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Plus, Search, MessageSquare, RefreshCw, X } from 'lucide-react';
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
    specialization_interest: string | null;
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
type Specialty = Database['public']['Tables']['specialties']['Row'];
type School = Database['public']['Tables']['schools']['Row'];

export default function AssignmentManager() {
  const { user, profile, activeSchoolId } = useAuthStore();
  const hasAdmin = hasAdminAccess(profile);
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Profile[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [filters, setFilters] = useState({
    status: '',
    studentId: '',
    roomIds: [] as string[],
    specialtyId: '',
    search: ''
  });
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [targetingMode, setTargetingMode] = useState<'individual' | 'bulk'>('individual');
  const [selectedStudent, setSelectedStudent] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>('');
  const [windowStart, setWindowStart] = useState<string>('');
  const [windowEnd, setWindowEnd] = useState<string>('');
  const [bulkTargetSchoolId, setBulkTargetSchoolId] = useState<string>('');
  const [bulkTargetSpecialty, setBulkTargetSpecialty] = useState<string>('');
  const [selectedBulkStudents, setSelectedBulkStudents] = useState<string[]>([]);
  const [editingAssignment, setEditingAssignment] = useState<{
    id: string;
    effective_date: string;
    due_date: string | null;
    window_start: string | null;
    window_end: string | null;
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
        fetchRooms(),
        fetchSpecialties(),
        fetchSchools()
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
          school_id,
          specialization_interest
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
      .select('id, full_name, study_year, email, role, school_id, specialization_interest')
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
      // Include rooms available to all schools (empty array)
      query = query.or(`school_id.eq.${scopedSchoolId},available_school_ids.cs.{${scopedSchoolId}},available_school_ids.cs.{}`);
    }

    const { data, error } = await query;

    if (error) throw error;
    setRooms(data || []);
  };

  const fetchSpecialties = async () => {
    let query = supabase
      .from('specialties')
      .select('*')
      .order('name');

    if (scopedSchoolId) {
      query = query.eq('school_id', scopedSchoolId);
    }

    const { data, error } = await query;

    if (error) throw error;
    setSpecialties(data || []);
  };

  const fetchSchools = async () => {
    const { data, error } = await supabase
      .from('schools')
      .select('*')
      .order('name');

    if (error) throw error;
    setSchools(data || []);
  };

  const handleAssign = async () => {
    if (!selectedRoom || !user || !effectiveDate) {
      alert('Please select a room and effective date');
      return;
    }

    // Determine which students to assign
    let studentsToAssign: string[] = [];

    if (targetingMode === 'individual') {
      if (!selectedStudent) {
        alert('Please select a student');
        return;
      }
      studentsToAssign = [selectedStudent];
    } else {
      // Bulk mode
      if (selectedBulkStudents.length === 0) {
        alert('Please select at least one student');
        return;
      }
      studentsToAssign = selectedBulkStudents;
    }

    try {
      // Convert effective date to UTC
      const effectiveDateTime = new Date(effectiveDate);

      // Calculate default due date if not specified and convert to UTC
      let calculatedDueDate = dueDate;
      if (!calculatedDueDate) {
        const defaultDueDate = new Date(effectiveDateTime.getTime() + 60 * 60 * 1000);
        calculatedDueDate = defaultDueDate.toISOString();
      } else {
        calculatedDueDate = new Date(calculatedDueDate).toISOString();
      }

      // Convert window dates to UTC if provided
      const windowStartUTC = windowStart ? new Date(windowStart).toISOString() : null;
      const windowEndUTC = windowEnd ? new Date(windowEnd).toISOString() : null;

      // Create assignments for all selected students with staggered delivery
      const assignments = studentsToAssign.map((studentId, index) => {
        const studentProfile = students.find((s) => s.id === studentId);
        const assignmentSchoolId = studentProfile?.school_id ?? scopedSchoolId;

        if (!assignmentSchoolId) {
          throw new Error(`Unable to determine school for student ${studentProfile?.full_name}`);
        }

        // Calculate staggered effective date
        // For bulk assignments, add random 5-10 minute offset
        // For individual assignments, use the base effective date
        let studentEffectiveDate = effectiveDateTime;
        if (targetingMode === 'bulk' && studentsToAssign.length > 1) {
          // Generate random offset between 5-10 minutes (300,000 to 600,000 ms)
          const randomOffset = Math.floor(Math.random() * 300000) + 300000;
          studentEffectiveDate = new Date(effectiveDateTime.getTime() + randomOffset);
        }
        const effectiveDateUTC = studentEffectiveDate.toISOString();

        return {
          student_id: studentId,
          room_id: parseInt(selectedRoom),
          assigned_by: user.id,
          status: 'assigned' as const,
          due_date: calculatedDueDate || null,
          effective_date: effectiveDateUTC || null,
          window_start: windowStartUTC,
          window_end: windowEndUTC,
          school_id: assignmentSchoolId,
        };
      });

      const { error } = await supabase
        .from('student_room_assignments')
        .insert(assignments);

      if (error) throw error;

      setShowAssignModal(false);
      setSelectedStudent('');
      setStudentSearch('');
      setSelectedRoom('');
      setDueDate('');
      setEffectiveDate('');
      setWindowStart('');
      setWindowEnd('');
      setTargetingMode('individual');
      setBulkTargetSchoolId('');
      setBulkTargetSpecialty('');
      setSelectedBulkStudents([]);
      await fetchAssignments();
    } catch (error) {
      console.error('Error assigning case:', error);
      alert(`Error assigning case: ${error instanceof Error ? error.message : 'Please try again.'}`);
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
      const updateData: Record<string, string | null> = {
        effective_date: new Date(editingAssignment.effective_date).toISOString(),
        due_date: editingAssignment.due_date ? new Date(editingAssignment.due_date).toISOString() : null,
        updated_at: new Date().toISOString()
      };

      if (editingAssignment.window_start) {
        updateData.window_start = new Date(editingAssignment.window_start).toISOString();
      }
      if (editingAssignment.window_end) {
        updateData.window_end = new Date(editingAssignment.window_end).toISOString();
      }

      const { error } = await supabase
        .from('student_room_assignments')
        .update(updateData)
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
    if (filters.roomIds.length > 0 && !filters.roomIds.includes(assignment.room_id.toString())) return false;
    if (filters.specialtyId) {
      // Check if the room's specialty_id or specialty_ids matches the filter
      const roomSpecialtyIds = [assignment.room.specialty_id, ...(assignment.room.specialty_ids || [])].filter(Boolean);
      if (!roomSpecialtyIds.includes(filters.specialtyId)) return false;
    }
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

  const getRoomsForSpecialty = () => {
    if (!filters.specialtyId) {
      return rooms;
    }
    return rooms.filter(room => {
      const roomSpecialtyIds = [room.specialty_id, ...(room.specialty_ids || [])].filter(Boolean);
      return roomSpecialtyIds.includes(filters.specialtyId);
    });
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      assigned: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      bedside: 'bg-green-100 text-green-800',
      completed: 'bg-green-100 text-green-800'
    };

    const label = status === 'bedside'
      ? 'Completed'
      : status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1);

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badges[status as keyof typeof badges]}`}>
        {label}
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
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
                  <option value="bedside">Bedside</option>
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
                <div className="mt-1">
                  <select
                    value=""
                    onChange={(e) => {
                      const roomId = e.target.value;
                      if (roomId && !filters.roomIds.includes(roomId)) {
                        setFilters({ ...filters, roomIds: [...filters.roomIds, roomId] });
                      }
                    }}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="">Add room filter...</option>
                    {getRoomsForSpecialty()
                      .filter(room => !filters.roomIds.includes(room.id.toString()))
                      .map(room => (
                        <option key={room.id} value={room.id}>
                          Room {room.room_number}
                        </option>
                      ))}
                  </select>
                  {filters.roomIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {filters.roomIds.map(roomId => {
                        const room = rooms.find(r => r.id.toString() === roomId);
                        return room ? (
                          <span
                            key={roomId}
                            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
                          >
                            Room {room.room_number}
                            <button
                              type="button"
                              onClick={() => setFilters({
                                ...filters,
                                roomIds: filters.roomIds.filter(id => id !== roomId)
                              })}
                              className="ml-2 inline-flex items-center"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Specialty</label>
                <select
                  value={filters.specialtyId}
                  onChange={(e) => setFilters({ ...filters, specialtyId: e.target.value, roomIds: [] })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">All Specialties</option>
                  {specialties.map(specialty => (
                    <option key={specialty.id} value={specialty.id}>
                      {specialty.name}
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
                        {assignment.student.specialization_interest && ` • ${assignment.student.specialization_interest}`}
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
                                const windowStart = 'window_start' in assignment && assignment.window_start
                                  ? new Date(assignment.window_start).toISOString().slice(0, 16)
                                  : null;
                                const windowEnd = 'window_end' in assignment && assignment.window_end
                                  ? new Date(assignment.window_end).toISOString().slice(0, 16)
                                  : null;

                                setEditingAssignment({
                                  id: assignment.id,
                                  effective_date: effectiveDate,
                                  due_date: dueDate,
                                  window_start: windowStart,
                                  window_end: windowEnd
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
                        {['completed', 'bedside'].includes(assignment.status) && (
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
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full sm:p-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Assign Case</h3>
                <div className="space-y-4">
                  {/* Targeting Mode Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Targeting Mode</label>
                    <div className="mt-2 flex gap-4">
                      <label className="inline-flex items-center">
                        <input
                          type="radio"
                          value="individual"
                          checked={targetingMode === 'individual'}
                          onChange={(e) => {
                            setTargetingMode(e.target.value as 'individual' | 'bulk');
                            setSelectedBulkStudents([]);
                          }}
                          className="form-radio h-4 w-4 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-700">Individual Student</span>
                      </label>
                      <label className="inline-flex items-center">
                        <input
                          type="radio"
                          value="bulk"
                          checked={targetingMode === 'bulk'}
                          onChange={(e) => {
                            setTargetingMode(e.target.value as 'individual' | 'bulk');
                            setSelectedStudent('');
                          }}
                          className="form-radio h-4 w-4 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-700">Bulk by School/Specialty</span>
                      </label>
                    </div>
                  </div>

                  {/* Room Selection */}
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

                  {/* Individual Student Selection */}
                  {targetingMode === 'individual' ? (
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
                              {student.specialization_interest && ` • ${student.specialization_interest}`}
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
                  ) : (
                    /* Bulk Student Selection */
                    <div className="space-y-4">
                      {/* School Filter */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Filter by School</label>
                        <select
                          value={bulkTargetSchoolId}
                          onChange={(e) => {
                            setBulkTargetSchoolId(e.target.value);
                            setSelectedBulkStudents([]);
                          }}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                          <option value="">All Schools</option>
                          {schools.map(school => (
                            <option key={school.id} value={school.id}>
                              {school.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Specialty Filter */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Filter by Specialty Interest</label>
                        <select
                          value={bulkTargetSpecialty}
                          onChange={(e) => {
                            setBulkTargetSpecialty(e.target.value);
                            setSelectedBulkStudents([]);
                          }}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        >
                          <option value="">All Specialties</option>
                          {specialties.map(specialty => (
                            <option key={specialty.id} value={specialty.name}>
                              {specialty.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Student List */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Select Students ({selectedBulkStudents.length} selected)
                        </label>
                        <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md">
                          {students
                            .filter(student => {
                              if (bulkTargetSchoolId && student.school_id !== bulkTargetSchoolId) return false;
                              if (bulkTargetSpecialty && student.specialization_interest !== bulkTargetSpecialty) return false;
                              return true;
                            })
                            .map(student => (
                              <label
                                key={student.id}
                                className={`flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer ${
                                  selectedBulkStudents.includes(student.id) ? 'bg-blue-50' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedBulkStudents.includes(student.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedBulkStudents([...selectedBulkStudents, student.id]);
                                    } else {
                                      setSelectedBulkStudents(selectedBulkStudents.filter(id => id !== student.id));
                                    }
                                  }}
                                  className="form-checkbox h-4 w-4 text-blue-600 focus:ring-blue-500"
                                />
                                <div className="ml-3 flex-1">
                                  <div className="font-medium text-gray-900">{student.full_name}</div>
                                  <div className="text-sm text-gray-500">
                                    Year {student.study_year}
                                    {student.specialization_interest && ` • ${student.specialization_interest}`}
                                    {student.school_id && ` • ${schools.find(s => s.id === student.school_id)?.name || student.school_id}`}
                                  </div>
                                </div>
                              </label>
                            ))}
                          {students.filter(student => {
                            if (bulkTargetSchoolId && student.school_id !== bulkTargetSchoolId) return false;
                            if (bulkTargetSpecialty && student.specialization_interest !== bulkTargetSpecialty) return false;
                            return true;
                          }).length === 0 && (
                            <div className="px-4 py-2 text-sm text-gray-500">
                              No students match the selected filters
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Effective Date */}
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

                  {/* Due Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Due Date (Optional)</label>
                    <input
                      type="datetime-local"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>

                  {/* Window Start */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Window Start (Optional)</label>
                    <input
                      type="datetime-local"
                      value={windowStart}
                      onChange={(e) => setWindowStart(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      Absolute start of the time window for this assignment.
                    </p>
                  </div>

                  {/* Window End */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Window End (Optional)</label>
                    <input
                      type="datetime-local"
                      value={windowEnd}
                      onChange={(e) => setWindowEnd(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      Absolute end of the time window for this assignment.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                <button
                  type="button"
                  onClick={handleAssign}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:col-start-2"
                >
                  {targetingMode === 'individual' ? 'Assign' : `Assign to ${selectedBulkStudents.length} student${selectedBulkStudents.length !== 1 ? 's' : ''}`}
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
                    setWindowStart('');
                    setWindowEnd('');
                    setTargetingMode('individual');
                    setBulkTargetSchoolId('');
                    setBulkTargetSpecialty('');
                    setSelectedBulkStudents([]);
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Window Start (Optional)</label>
                    <input
                      type="datetime-local"
                      value={editingAssignment.window_start || ''}
                      onChange={(e) => setEditingAssignment({
                        ...editingAssignment,
                        window_start: e.target.value || null
                      })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      Absolute start of the time window for this assignment.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Window End (Optional)</label>
                    <input
                      type="datetime-local"
                      value={editingAssignment.window_end || ''}
                      onChange={(e) => setEditingAssignment({
                        ...editingAssignment,
                        window_end: e.target.value || null
                      })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      Absolute end of the time window for this assignment.
                    </p>
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
