import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Plus, Search, MessageSquare, ClipboardList, RefreshCw, X, ArrowUp, ArrowDown } from 'lucide-react';
import AdminLayout from '../components/admin/AdminLayout';
import type { Database } from '../lib/database.types';
import { useAuthStore } from '../stores/authStore';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import {
  ASSIGNABLE_STUDENT_LOOKBACK_MONTHS,
  getAssignableStudentCutoffDate,
  isAssignableStudentProfile,
} from '../lib/studentVisibility';
import { getSchoolDisplayName } from '../hooks/useSchools';
import { classifyFeedbackScore } from '../lib/feedbackScore';
import { withTimeout } from '../lib/asyncTimeout';
import { buildAssignmentListQuery } from '../lib/assignmentQueries';

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
  } | null;
};

type Room = Database['public']['Tables']['rooms']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];
type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
type Specialty = Database['public']['Tables']['specialties']['Row'];
type School = Database['public']['Tables']['schools']['Row'];

type EvidenceAuditEvent = {
  id: string;
  type: string;
  timestamp: string;
  details: string;
};

type EvidenceAudit = {
  assignment: Pick<Database['public']['Tables']['student_room_assignments']['Row'],
    'feedback_debrief' | 'communication_breakdown' | 'mdm_breakdown' | 'safety_result' |
    'scoring_start_at' | 'rubric_version' | 'case_key_version' | 'assessment_version' |
    'source_event_ids' | 'technical_incomplete' | 'feedback_status' | 'feedback_error'>;
  firstPage: { id: string; timestamp: string; details: string } | null;
  events: EvidenceAuditEvent[];
  latestRun: {
    id: string;
    created_at: string;
    attempt_id: string;
    rubric_version: string;
    case_key_version: string;
    assessment_version: string;
    technical_incomplete: boolean;
    scoring_start_at: string | null;
    source_event_ids: Database['public']['Tables']['feedback_assessment_runs']['Row']['source_event_ids'];
    result: Database['public']['Tables']['feedback_assessment_runs']['Row']['result'];
  } | null;
};

export default function AssignmentManager() {
  const { user, profile, activeSchoolId } = useAuthStore();
  const hasAdmin = hasAdminAccess(profile);
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [windowStart, setWindowStart] = useState<string>('');
  const [windowEnd, setWindowEnd] = useState<string>('');
  const [selectedTimezone, setSelectedTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver');
  const [bulkTargetSchoolId, setBulkTargetSchoolId] = useState<string>('');
  const [bulkTargetSpecialty, setBulkTargetSpecialty] = useState<string>('');
  const [selectedBulkStudents, setSelectedBulkStudents] = useState<string[]>([]);
  const [editingAssignment, setEditingAssignment] = useState<{
    id: string;
    window_start: string;
    window_end: string;
  } | null>(null);
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedChatMessages, setSelectedChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [evidenceAudit, setEvidenceAudit] = useState<EvidenceAudit | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const evidenceCloseButtonRef = useRef<HTMLButtonElement>(null);
  const [assignmentsWithPersistedChat, setAssignmentsWithPersistedChat] = useState<Set<string>>(new Set());
  const [rerunningAssessments, setRerunningAssessments] = useState<Set<string>>(new Set());
  const assignableStudents = students.filter((student) => isAssignableStudentProfile(student));
  const assignableStudentCutoff = getAssignableStudentCutoffDate();

  const fetchPersistedChatAssignmentIds = async (assignmentIds: string[]) => {
    const result = new Set<string>();
    // Keep the `in` filter bounded. All-school admin views can contain thousands
    // of assignments, and a 1,000-ID URL can exceed the REST gateway envelope.
    const pageSize = 200;
    for (let from = 0; from < assignmentIds.length; from += pageSize) {
      const { data, error } = await withTimeout(
        supabase
          .from('chat_messages')
          .select('assignment_id')
          .in('assignment_id', assignmentIds.slice(from, from + pageSize))
          .range(0, pageSize - 1),
        'chat evidence lookup'
      );
      if (error) throw error;
      (data ?? []).forEach((message) => result.add(message.assignment_id));
    }
    return result;
  };

  const getOverallScore = (feedback: Database['public']['Tables']['student_room_assignments']['Row']['nurse_feedback']) => {
    if (feedback && typeof feedback === 'object' && !Array.isArray(feedback) && 'overall_score' in feedback) {
      return feedback.overall_score;
    }
    return undefined;
  };

  useEffect(() => {
    if (!hasAdmin) return;
    const loadData = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const assignmentsQuery = buildAssignmentListQuery(supabase, scopedSchoolId);

        let studentsQuery = supabase
          .from('profiles')
          .select('id, full_name, study_year, email, role, school_id, specialization_interest, created_at')
          .eq('role', 'student')
          .order('full_name');

        let roomsQuery = supabase
          .from('rooms')
          .select('*')
          .order('room_number');

        let specialtiesQuery = supabase
          .from('specialties')
          .select('*')
          .order('name');

        if (scopedSchoolId) {
          studentsQuery = studentsQuery.eq('school_id', scopedSchoolId);
          roomsQuery = roomsQuery.or(`school_id.eq.${scopedSchoolId},available_school_ids.cs.{${scopedSchoolId}},available_school_ids.cs.{}`);
          specialtiesQuery = specialtiesQuery.or(`school_id.eq.${scopedSchoolId},school_id.is.null`);
        }

        const [
          assignmentsResult,
          studentsResult,
          roomsResult,
          specialtiesResult,
          schoolsResult,
        ] = await withTimeout(Promise.all([
          assignmentsQuery,
          studentsQuery,
          roomsQuery,
          specialtiesQuery,
          supabase.from('schools').select('*').order('name'),
        ]), 'case assignments data load', 30000);

        if (assignmentsResult.error) throw assignmentsResult.error;
        if (studentsResult.error) throw studentsResult.error;
        if (roomsResult.error) throw roomsResult.error;
        if (specialtiesResult.error) throw specialtiesResult.error;
        if (schoolsResult.error) throw schoolsResult.error;

        const loadedAssignments = ((assignmentsResult.data ?? []) as Assignment[]).filter(a => a.room !== null);
        setAssignments(loadedAssignments);
        setAssignmentsWithPersistedChat(await fetchPersistedChatAssignmentIds(loadedAssignments.map((assignment) => assignment.id)));
        setStudents(studentsResult.data || []);
        setRooms(roomsResult.data || []);
        setSpecialties(specialtiesResult.data || []);
        setSchools(schoolsResult.data || []);
      } catch (error) {
        console.error('Error fetching data:', error);
        setLoadError(error instanceof Error ? error.message : 'Unable to load case assignments.');
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [hasAdmin, scopedSchoolId]);

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
    const loadedAssignments = ((data ?? []) as Assignment[]).filter(a => a.room !== null);
    setAssignments(loadedAssignments);
    setAssignmentsWithPersistedChat(await fetchPersistedChatAssignmentIds(loadedAssignments.map((assignment) => assignment.id)));
  };

  const validateRoomOrdersConfig = (room: Room): boolean => {
    if (!room.orders_config) return false;
    const config = room.orders_config as { labs?: Array<{ name: string; type: string }> };
    return config.labs && config.labs.length > 0;
  };


  const validateAssignmentDates = (
    windowStart: string,
    windowEnd: string
  ): { valid: boolean; error?: string } => {
    const windowStartUTC = convertToUTC(windowStart, selectedTimezone);
    const windowEndUTC = convertToUTC(windowEnd, selectedTimezone);

    if (!windowStartUTC || !windowEndUTC) {
      return { valid: false, error: 'Please provide valid window start and end times.' };
    }

    const windowStartMs = windowStartUTC.getTime();
    const windowEndMs = windowEndUTC.getTime();

    // Check that window start is not in the past
    const now = new Date();
    if (windowStartMs < now.getTime()) {
      return { valid: false, error: 'Window start cannot be in the past.' };
    }

    // Check that window end is after window start
    if (windowEndMs <= windowStartMs) {
      return { valid: false, error: 'Window end must be after the window start.' };
    }

    // Ensure there's enough time for the window (at least 20 minutes for multiple cases)
    const minWindowDuration = 20 * 60 * 1000; // 20 minutes in ms
    if (windowEndMs - windowStartMs < minWindowDuration) {
      return { valid: false, error: 'Window must be at least 20 minutes long (first case within 20 minutes of start).' };
    }

    return { valid: true };
  };

  // Slot padding: ensures minimum time between any two assignments
  const SLOT_PADDING_MINUTES = 20;
  const FIRST_CASE_WINDOW_MINUTES = 20;

  const moveSelectedRoom = (roomId: string, direction: 'up' | 'down') => {
    setSelectedRooms((prev) => {
      const currentIndex = prev.indexOf(roomId);
      if (currentIndex === -1) return prev;
      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
      return next;
    });
  };

  const buildRandomGaps = (count: number, minGapMs: number, extraMs: number): number[] => {
    if (count <= 0) return [];
    if (extraMs <= 0) return Array.from({ length: count }, () => minGapMs);
    const weights = Array.from({ length: count }, () => Math.random());
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const extras = weights.map((weight) => Math.floor((weight / totalWeight) * extraMs));
    let remainder = extraMs - extras.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < extras.length && remainder > 0; i += 1) {
      extras[i] += 1;
      remainder -= 1;
    }
    return extras.map((extra) => minGapMs + extra);
  };

  const handleAssign = async () => {
    if (selectedRooms.length === 0 || !user || !windowStart || !windowEnd) {
      alert('Please select at least one room and set the window start and end times');
      return;
    }

    // Validate that all selected rooms have orders configured
    const selectedRoomsData = rooms.filter(r => selectedRooms.includes(r.id.toString()));
    if (selectedRoomsData.length !== selectedRooms.length) {
      alert('Some selected rooms not found');
      return;
    }

    const invalidRooms = selectedRoomsData.filter(room => !validateRoomOrdersConfig(room));
    if (invalidRooms.length > 0) {
      alert(`The following rooms do not have orders configured: ${invalidRooms.map(r => `Room ${r.room_number}`).join(', ')}. Please configure orders for these rooms before creating assignments.`);
      return;
    }

    // Validate date constraints
    const dateValidation = validateAssignmentDates(windowStart, windowEnd);
    if (!dateValidation.valid) {
      alert(dateValidation.error);
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
      // Convert window dates from selected timezone to UTC
      // TODO: Consider date-fns-tz for more robust timezone handling.
      const windowStartUTCDate = convertToUTC(windowStart, selectedTimezone);
      const windowEndUTCDate = convertToUTC(windowEnd, selectedTimezone);

      if (!windowStartUTCDate || !windowEndUTCDate) {
        alert('Please provide valid window start and end times.');
        return;
      }

      const windowStartMs = windowStartUTCDate.getTime();
      const windowEndMs = windowEndUTCDate.getTime();
      const windowDuration = windowEndMs - windowStartMs;
      const windowDurationMinutes = windowDuration / (60 * 1000);

      // Check if window duration is sufficient for selected rooms with slot padding
      const totalSlotsNeeded = (selectedRooms.length * SLOT_PADDING_MINUTES) - SLOT_PADDING_MINUTES;
      if (windowDurationMinutes < totalSlotsNeeded) {
        alert(`Warning: With ${selectedRooms.length} room(s), minimum time needed between assignments is ${totalSlotsNeeded} minutes due to ${SLOT_PADDING_MINUTES}-minute slot padding. Current window: ${windowDurationMinutes.toFixed(0)} minutes. Consider increasing the window duration or reducing the number of rooms.`);
        return;
      }

      const windowStartUTC = windowStartUTCDate.toISOString();
      const windowEndUTC = windowEndUTCDate.toISOString();

      // Create N x M assignments (each student gets each room)
      const assignments: Array<{
        student_id: string;
        room_id: number;
        assigned_by: string;
        status: 'assigned';
        effective_date: string | null;
        window_start: string | null;
        window_end: string | null;
        school_id: string;
      }> = [];

      for (const studentId of studentsToAssign) {
        const studentProfile = students.find((s) => s.id === studentId);
        const assignmentSchoolId = studentProfile?.school_id ?? scopedSchoolId;

        if (!assignmentSchoolId) {
          throw new Error(`Unable to determine school for student ${studentProfile?.full_name}`);
        }

        const minTotalGapMs = (selectedRooms.length - 1) * SLOT_PADDING_MINUTES * 60 * 1000;
        const earliestFirstCaseMs = windowStartMs;
        const latestFirstCaseMs = Math.min(
          windowStartMs + (FIRST_CASE_WINDOW_MINUTES * 60 * 1000),
          windowEndMs - minTotalGapMs
        );

        if (latestFirstCaseMs < earliestFirstCaseMs) {
          throw new Error('Window is too short to schedule all cases with required spacing.');
        }

        const firstCaseOffset = Math.floor(Math.random() * (latestFirstCaseMs - earliestFirstCaseMs + 1));
        const firstCaseMs = earliestFirstCaseMs + firstCaseOffset;
        const availableSpanMs = windowEndMs - firstCaseMs;
        const extraSpacingMs = Math.max(0, availableSpanMs - minTotalGapMs);
        const extraSpacingUsedMs = Math.floor(Math.random() * (extraSpacingMs + 1));
        const gapMs = buildRandomGaps(
          selectedRooms.length - 1,
          SLOT_PADDING_MINUTES * 60 * 1000,
          extraSpacingUsedMs,
        );
        const scheduledRooms = [...selectedRooms];

        let currentCaseMs = firstCaseMs;
        for (const [roomIndex, roomId] of scheduledRooms.entries()) {
          if (roomIndex > 0) {
            currentCaseMs += gapMs[roomIndex - 1];
          }
          const studentEffectiveDate = new Date(currentCaseMs);

          assignments.push({
            student_id: studentId,
            room_id: parseInt(roomId),
            assigned_by: user.id,
            status: 'assigned' as const,
            effective_date: studentEffectiveDate.toISOString(),
            window_start: windowStartUTC,
            window_end: windowEndUTC,
            school_id: assignmentSchoolId,
          });
        }
      }

      const { error } = await supabase
        .from('student_room_assignments')
        .insert(assignments);

      if (error) throw error;

      setShowAssignModal(false);
      setSelectedStudent('');
      setStudentSearch('');
      setSelectedRooms([]);
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

    // Validate date constraints
    const dateValidation = validateAssignmentDates(
      editingAssignment.window_start,
      editingAssignment.window_end
    );
    if (!dateValidation.valid) {
      alert(dateValidation.error);
      return;
    }

    try {
      const windowStartUTCDate = convertToUTC(editingAssignment.window_start, selectedTimezone);
      const windowEndUTCDate = convertToUTC(editingAssignment.window_end, selectedTimezone);

      if (!windowStartUTCDate || !windowEndUTCDate) {
        alert('Please provide valid window start and end times.');
        return;
      }

      // Re-calculate the effective_date based on the new window
      const windowStartMs = windowStartUTCDate.getTime();
      const windowEndMs = windowEndUTCDate.getTime();
      const windowDuration = windowEndMs - windowStartMs;
      const randomOffset = Math.floor(Math.random() * windowDuration);
      const newEffectiveDate = new Date(windowStartMs + randomOffset).toISOString();

      const updateData: Record<string, string | null> = {
        window_start: windowStartUTCDate.toISOString(),
        window_end: windowEndUTCDate.toISOString(),
        effective_date: newEffectiveDate,
        updated_at: new Date().toISOString()
      };

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
    setChatLoading(true);
    setChatError(null);
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
      setChatError(error instanceof Error ? error.message : 'Unable to read persisted chat events for this attempt.');
      return [];
    } finally {
      setChatLoading(false);
    }
  };

  const handleViewChat = async (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    const messages = await fetchChatMessages(assignment.id);
    setSelectedChatMessages(messages);
    setShowChatModal(true);
  };

  const handleViewEvidence = async (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setShowEvidenceModal(true);
    setEvidenceAudit(null);
    setEvidenceError(null);
    setEvidenceLoading(true);
    try {
      const [assignmentResult, messagesResult, ordersResult, labsResult, vitalsResult, imagingResult, learnerActionsResult, runResult] = await Promise.all([
        supabase.from('student_room_assignments')
          .select('feedback_debrief, communication_breakdown, mdm_breakdown, safety_result, scoring_start_at, rubric_version, case_key_version, assessment_version, source_event_ids, technical_incomplete, feedback_status, feedback_error')
          .eq('id', assignment.id)
          .single(),
        supabase.from('chat_messages').select('id, role, content, created_at').eq('assignment_id', assignment.id).order('created_at', { ascending: true }),
        supabase.from('medical_orders').select('id, order_name, dose, route, frequency, priority, status, instructions, order_time, created_at').eq('assignment_id', assignment.id).is('deleted_at', null),
        supabase.from('lab_results').select('id, test_name, value, unit, text_value, status, interpretation, collection_time, result_time, created_at').eq('assignment_id', assignment.id).is('deleted_at', null),
        supabase.from('vital_signs').select('id, timestamp, temperature, blood_pressure_systolic, blood_pressure_diastolic, heart_rate, respiratory_rate, oxygen_saturation, pain').eq('assignment_id', assignment.id).is('deleted_at', null),
        supabase.from('imaging_studies').select('id, study_type, order_name, status, report, order_time, report_generated_at, created_at').eq('assignment_id', assignment.id).is('deleted_at', null),
        (supabase as any).from('learner_action_events').select('id, action_type, channel, content, occurred_at, created_at').eq('assignment_id', assignment.id).order('occurred_at', { ascending: true }),
        supabase.from('feedback_assessment_runs').select('id, created_at, attempt_id, rubric_version, case_key_version, assessment_version, technical_incomplete, scoring_start_at, source_event_ids, result').eq('assignment_id', assignment.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      for (const result of [assignmentResult, messagesResult, ordersResult, labsResult, vitalsResult, imagingResult, learnerActionsResult, runResult]) {
        if (result.error) throw result.error;
      }

      const messages = messagesResult.data ?? [];
      const firstPageMessage = messages
        .filter((message) => (message.role === 'assistant' || message.role === 'nurse') && message.content !== '<completed>' && message.created_at)
        .sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime())[0];
      const persistedStart = assignmentResult.data.scoring_start_at;
      const scoringStart = persistedStart ?? (firstPageMessage?.created_at ? new Date(firstPageMessage.created_at).toISOString() : null);
      const isPostPage = (timestamp: string | null) => Boolean(timestamp && scoringStart && new Date(timestamp).getTime() >= new Date(scoringStart).getTime());
      const events: EvidenceAuditEvent[] = [];
      const timestamp = (value: string | null) => value ? new Date(value).toISOString() : null;

      messages.forEach((message) => {
        const eventTimestamp = timestamp(message.created_at);
        if (!eventTimestamp || !isPostPage(eventTimestamp)) return;
        events.push({
          id: `message-${message.id}`,
          type: message.role === 'student' || message.role === 'user' ? 'student_chat' : 'nurse_chat',
          timestamp: eventTimestamp,
          details: message.content,
        });
      });

      (ordersResult.data ?? []).forEach((order) => {
        const eventTimestamp = timestamp(order.order_time ?? order.created_at);
        if (!eventTimestamp || !isPostPage(eventTimestamp)) return;
        events.push({ id: `order-${order.id}`, type: 'medical_order', timestamp: eventTimestamp, details: [order.order_name, order.dose, order.route, order.frequency, order.priority, order.status, order.instructions].filter(Boolean).join(' • ') });
      });
      const labsByTimestamp = new Map<string, string[]>();
      (labsResult.data ?? []).forEach((lab) => {
        const eventTimestamp = timestamp(lab.result_time ?? lab.collection_time ?? lab.created_at);
        if (!eventTimestamp || !isPostPage(eventTimestamp)) return;
        const details = [lab.test_name, lab.value !== null ? `${lab.value}${lab.unit ? ` ${lab.unit}` : ''}` : lab.text_value, lab.status, lab.interpretation].filter(Boolean).join(' • ');
        labsByTimestamp.set(eventTimestamp, [...(labsByTimestamp.get(eventTimestamp) ?? []), details]);
      });
      labsByTimestamp.forEach((details, eventTimestamp) => events.push({ id: `labs-assignment-${eventTimestamp.slice(0, 16)}`, type: 'lab_result', timestamp: eventTimestamp, details: details.join('\n') }));
      (vitalsResult.data ?? []).forEach((vital) => {
        const eventTimestamp = timestamp(vital.timestamp);
        if (!eventTimestamp || !isPostPage(eventTimestamp)) return;
        events.push({ id: `vital-${vital.id}`, type: 'vital_signs', timestamp: eventTimestamp, details: [vital.temperature !== null ? `T ${vital.temperature}` : null, vital.blood_pressure_systolic !== null && vital.blood_pressure_diastolic !== null ? `BP ${vital.blood_pressure_systolic}/${vital.blood_pressure_diastolic}` : null, vital.heart_rate !== null ? `HR ${vital.heart_rate}` : null, vital.respiratory_rate !== null ? `RR ${vital.respiratory_rate}` : null, vital.oxygen_saturation !== null ? `SpO2 ${vital.oxygen_saturation}%` : null, vital.pain !== null ? `Pain ${vital.pain}/10` : null].filter(Boolean).join(' • ') });
      });
      (imagingResult.data ?? []).forEach((study) => {
        const eventTimestamp = timestamp(study.report_generated_at ?? study.order_time ?? study.created_at);
        if (!eventTimestamp || !isPostPage(eventTimestamp)) return;
        events.push({ id: `imaging-${study.id}`, type: 'imaging_study', timestamp: eventTimestamp, details: [study.order_name || study.study_type, study.status, study.report].filter(Boolean).join(' • ') });
      });
      (learnerActionsResult.data ?? []).forEach((action) => {
        const eventTimestamp = timestamp(action.occurred_at ?? action.created_at);
        if (!eventTimestamp || !isPostPage(eventTimestamp)) return;
        events.push({ id: `learner-action-${action.id}`, type: `learner_${action.action_type} · ${action.channel}`, timestamp: eventTimestamp, details: action.content });
      });
      if (assignment.student_progress_note?.trim() && assignment.completed_at && isPostPage(assignment.completed_at)) {
        events.push({ id: `progress-note-${assignment.id}`, type: 'progress_note', timestamp: new Date(assignment.completed_at).toISOString(), details: assignment.student_progress_note.trim() });
      }
      events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setEvidenceAudit({
        assignment: assignmentResult.data,
        firstPage: firstPageMessage?.created_at ? { id: String(firstPageMessage.id), timestamp: new Date(firstPageMessage.created_at).toISOString(), details: firstPageMessage.content } : null,
        events,
        latestRun: runResult.data,
      });
    } catch (error) {
      console.error('Error fetching assignment evidence audit:', error);
      setEvidenceError(error instanceof Error ? error.message : 'Unable to read assignment evidence audit.');
    } finally {
      setEvidenceLoading(false);
    }
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

  const filteredStudents = assignableStudents.filter((student) => {
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

    const label = status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1);

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badges[status as keyof typeof badges]}`}>
        {label}
      </span>
    );
  };

  // Convert datetime-local input string to UTC Date using selected timezone
  function convertToUTC(localDateTime: string, timezone: string): Date | null {
    if (!localDateTime) return null;
    const [year, month, day, hour, minute] = localDateTime.split(/[-T:]/).map(Number);
    if ([year, month, day, hour, minute].some(Number.isNaN)) return null;

    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const offsetMs = getTimeZoneOffsetMs(utcGuess, timezone);
    return new Date(utcGuess.getTime() - offsetMs);
  }

  // Convert UTC Date back to datetime-local string for selected timezone
  function formatForDateTimeLocal(utcDate: Date, timezone: string): string {
    const localString = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(utcDate);
    const [datePart, timePart] = localString.split(', ');
    const [month, day, year] = datePart.trim().split('/');
    const [hour, minute] = timePart.trim().split(':');
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  function getTimeZoneOffsetMs(date: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date);

    const lookup = parts.reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

    const zonedTime = Date.UTC(
      Number(lookup.year),
      Number(lookup.month) - 1,
      Number(lookup.day),
      Number(lookup.hour),
      Number(lookup.minute),
      Number(lookup.second)
    );

    return zonedTime - date.getTime();
  }

  const formatDate = (date: string | null) => {
    if (!date) return 'Not set';
    const dateObj = new Date(date);
    return `${dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
  };

  const windowStartUTCPreview = windowStart
    ? convertToUTC(windowStart, selectedTimezone)?.toISOString() ?? ''
    : '';
  const windowEndUTCPreview = windowEnd
    ? convertToUTC(windowEnd, selectedTimezone)?.toISOString() ?? ''
    : '';
  const editWindowEndUTCPreview = editingAssignment?.window_end
    ? convertToUTC(editingAssignment.window_end, selectedTimezone)?.toISOString() ?? ''
    : '';

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

  if (loadError) {
    return (
      <AdminLayout>
        <div className="mx-auto max-w-3xl px-6 py-12">
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            <h2 className="font-semibold">Case Assignments could not be loaded</h2>
            <p className="mt-2">{loadError}</p>
            <p className="mt-2 text-red-700">Check the selected school scope and try again. No assignment data was changed.</p>
          </div>
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
                    Window
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
                      <div>{formatDate(assignment.window_start)}</div>
                      <div className="text-xs">to {formatDate(assignment.window_end)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {assignment.nurse_feedback ? (
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">
                            {(() => {
                              const score = classifyFeedbackScore(getOverallScore(assignment.nurse_feedback), 'legacy');
                              if (score.kind === 'legacy') {
                                return (
                                <>
                                  <div>{score.displayText}</div>
                                  <div className="mt-1 text-xs font-normal text-gray-500">{score.explanation}</div>
                                </>
                                );
                              }
                              const canonicalScores = [
                                typeof assignment.communication_score === 'number' ? `Communication: ${assignment.communication_score}/5` : null,
                                typeof assignment.mdm_score === 'number' ? `MDM: ${assignment.mdm_score}/5` : null,
                              ].filter((value): value is string => value !== null);
                              return canonicalScores.length > 0 ? canonicalScores.join(' · ') : score.displayText;
                            })()}
                          </div>
                          <div className="text-gray-500">
                            Feedback provided
                          </div>
                          {!assignmentsWithPersistedChat.has(assignment.id) && (
                            <div className="text-xs text-amber-700">No persisted chat evidence</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-gray-500">
                          No feedback yet
                          {!assignmentsWithPersistedChat.has(assignment.id) && (
                            <span className="block text-xs text-amber-700">No persisted chat evidence</span>
                          )}
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
                                const windowStart = assignment.window_start
                                  ? formatForDateTimeLocal(new Date(assignment.window_start), selectedTimezone)
                                  : '';
                                const windowEnd = assignment.window_end
                                  ? formatForDateTimeLocal(new Date(assignment.window_end), selectedTimezone)
                                  : '';

                                setEditingAssignment({
                                  id: assignment.id,
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
                              onClick={() => void handleViewEvidence(assignment)}
                              className="inline-flex items-center px-3 py-2 border border-indigo-300 shadow-sm text-sm leading-4 font-medium rounded-md text-indigo-700 bg-white hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            >
                              <ClipboardList className="w-4 h-4 mr-1" />
                              View Evidence/Audit
                            </button>
                            {assignment.status === 'completed' && (
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
                            )}
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
                    <label className="block text-sm font-medium text-gray-700">Select Rooms ({selectedRooms.length} selected)</label>
                    <div className="mt-2 grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Available Rooms</p>
                        <div className="mt-2 max-h-56 overflow-y-auto border border-gray-200 rounded-md">
                          {rooms.map(room => {
                            const roomId = room.id.toString();
                            const hasOrdersConfig = validateRoomOrdersConfig(room);
                            const isSelected = selectedRooms.includes(roomId);
                            return (
                              <button
                                key={room.id}
                                type="button"
                                disabled={!hasOrdersConfig || isSelected}
                                onClick={() => setSelectedRooms([...selectedRooms, roomId])}
                                className={`w-full text-left px-4 py-2 hover:bg-gray-50 focus:outline-none ${
                                  isSelected ? 'bg-blue-50 text-blue-900' : 'text-gray-900'
                                } ${!hasOrdersConfig ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                <div className="font-medium">Room {room.room_number}</div>
                                <div className="text-sm text-gray-500">
                                  {room.difficulty_level || 'No difficulty set'}
                                  {!hasOrdersConfig && ' • No orders configured'}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Scheduled Order</p>
                        <div className="mt-2 min-h-[6rem] max-h-56 overflow-y-auto border border-gray-200 rounded-md">
                          {selectedRooms.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-gray-500">Select rooms to build the schedule order.</div>
                          ) : (
                            selectedRooms.map((roomId, index) => {
                              const room = rooms.find((r) => r.id.toString() === roomId);
                              return (
                                <div key={roomId} className="flex items-center justify-between px-4 py-2 border-b last:border-b-0">
                                  <div>
                                    <div className="font-medium text-gray-900">#{index + 1} • Room {room?.room_number ?? roomId}</div>
                                    <div className="text-xs text-gray-500">{room?.difficulty_level || 'No difficulty set'}</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => moveSelectedRoom(roomId, 'up')}
                                      disabled={index === 0}
                                      className="inline-flex items-center rounded-md border border-gray-200 p-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      <ArrowUp className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => moveSelectedRoom(roomId, 'down')}
                                      disabled={index === selectedRooms.length - 1}
                                      className="inline-flex items-center rounded-md border border-gray-200 p-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedRooms(selectedRooms.filter(id => id !== roomId))}
                                      className="inline-flex items-center rounded-md border border-gray-200 p-1 text-red-600 hover:bg-red-50"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                    {selectedRooms.length > 0 && (
                      <p className="mt-2 text-sm text-gray-600">
                        {selectedRooms.length} room{selectedRooms.length !== 1 ? 's' : ''} selected. Each student will be assigned in the order shown.
                      </p>
                    )}
                  </div>

                  {/* Individual Student Selection */}
                  {targetingMode === 'individual' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Search Students</label>
                      <p className="mt-1 text-xs text-gray-500">
                        Showing students created within the last {ASSIGNABLE_STUDENT_LOOKBACK_MONTHS} months
                        (since {assignableStudentCutoff.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}).
                      </p>
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
                              {getSchoolDisplayName(school)}
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
                        <p className="mt-1 text-xs text-gray-500">
                          Showing students created within the last {ASSIGNABLE_STUDENT_LOOKBACK_MONTHS} months
                          (since {assignableStudentCutoff.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}).
                        </p>
                        <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md">
                          {assignableStudents
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
                          {assignableStudents.filter(student => {
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

                  {/* Timezone Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Timezone</label>
                    <select
                      value={selectedTimezone}
                      onChange={(e) => setSelectedTimezone(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="America/Denver">Mountain Time (Denver)</option>
                      <option value="America/Phoenix">Arizona Time (Phoenix - No DST)</option>
                      <option value="America/Chicago">Central Time (Chicago)</option>
                      <option value="America/New_York">Eastern Time (New York)</option>
                      <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
                      <option value="UTC">UTC</option>
                    </select>
                    <p className="mt-1 text-sm text-gray-500">
                      Select the timezone for the window start/end times you enter above.
                    </p>
                  </div>

                  {/* Window Start */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Window Start <span className="text-red-500">*</span></label>
                    <input
                      type="datetime-local"
                      value={windowStart}
                      onChange={(e) => setWindowStart(e.target.value)}
                      required
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      The earliest time cases can become active. Each student will be randomly assigned a time within the window.
                    </p>
                    {windowStartUTCPreview && (
                      <p className="mt-2 text-sm text-blue-600">
                        <strong>Note:</strong> This will be saved as UTC: {windowStartUTCPreview}
                      </p>
                    )}
                  </div>

                  {/* Window End */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Window End <span className="text-red-500">*</span></label>
                    <input
                      type="datetime-local"
                      value={windowEnd}
                      onChange={(e) => setWindowEnd(e.target.value)}
                      required
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      The latest time cases can become active. Minimum window length is {selectedRooms.length * 20} minutes for {selectedRooms.length} room{selectedRooms.length !== 1 ? 's' : ''} (first case within 20 min + 20 min spacing).
                    </p>
                    {windowEndUTCPreview && (
                      <p className="mt-2 text-sm text-blue-600">
                        <strong>Note:</strong> This will be saved as UTC: {windowEndUTCPreview}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                <button
                  type="button"
                  onClick={handleAssign}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:col-start-2"
                >
                  {(() => {
                    const studentCount = targetingMode === 'individual' ? 1 : selectedBulkStudents.length;
                    const totalAssignments = studentCount * selectedRooms.length;
                    return targetingMode === 'individual'
                      ? `Create ${totalAssignments} assignment${totalAssignments !== 1 ? 's' : ''}`
                      : `Create ${totalAssignments} assignment${totalAssignments !== 1 ? 's' : ''} for ${studentCount} student${studentCount !== 1 ? 's' : ''}`;
                  })()}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAssignModal(false);
                    setSelectedStudent('');
                    setStudentSearch('');
                    setSelectedRooms([]);
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
                    <label className="block text-sm font-medium text-gray-700">Window Start <span className="text-red-500">*</span></label>
                    <input
                      type="datetime-local"
                      value={editingAssignment.window_start}
                      onChange={(e) => setEditingAssignment({
                        ...editingAssignment,
                        window_start: e.target.value
                      })}
                      required
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      The earliest time cases can become active. A new activation time will be randomly selected within the window.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Window End <span className="text-red-500">*</span></label>
                    <input
                      type="datetime-local"
                      value={editingAssignment.window_end}
                      onChange={(e) => setEditingAssignment({
                        ...editingAssignment,
                        window_end: e.target.value
                      })}
                      required
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      The latest time cases can become active. Minimum window is 20 minutes (first case within 20 min of window start).
                    </p>
                    {editWindowEndUTCPreview && (
                      <p className="mt-2 text-sm text-blue-600">
                        <strong>Note:</strong> This will be saved as UTC: {editWindowEndUTCPreview}
                      </p>
                    )}
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
                  {chatLoading && <p className="rounded-md bg-gray-50 p-4 text-sm text-gray-600">Loading persisted chat events…</p>}
                  {!chatLoading && chatError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Chat history could not be read: {chatError}</p>}
                  {!chatLoading && !chatError && selectedChatMessages.length === 0 && <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No chat events were persisted for this attempt. This is different from an empty loading state; check the assignment event log before interpreting feedback.</p>}
                  {!chatLoading && selectedChatMessages.map((message) => (
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

      {showEvidenceModal && selectedAssignment && (
        <EvidenceAuditModal
          assignment={selectedAssignment}
          audit={evidenceAudit}
          loading={evidenceLoading}
          error={evidenceError}
          closeButtonRef={evidenceCloseButtonRef}
          onClose={() => {
            setShowEvidenceModal(false);
            setEvidenceAudit(null);
            setEvidenceError(null);
          }}
        />
      )}
    </AdminLayout>
  );
}

function EvidenceAuditModal({
  assignment,
  audit,
  loading,
  error,
  closeButtonRef,
  onClose,
}: {
  assignment: Assignment;
  audit: EvidenceAudit | null;
  loading: boolean;
  error: string | null;
  closeButtonRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeButtonRef, onClose]);

  const json = (value: unknown) => value == null ? 'None recorded' : JSON.stringify(value, null, 2);
  const close = <button ref={closeButtonRef} type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">Close</button>;

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto" role="presentation">
      <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose} aria-hidden="true" />
      <div className="flex min-h-screen items-end justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div role="dialog" aria-modal="true" aria-labelledby="evidence-audit-title" className="relative inline-block w-full max-w-5xl transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left align-bottom shadow-xl sm:my-8 sm:p-6 sm:align-middle">
          <h2 id="evidence-audit-title" className="text-lg font-semibold text-gray-900">Evidence Audit — {assignment.student.full_name}, Room {assignment.room?.room_number}</h2>
          <p className="mt-1 text-sm text-gray-500">Read-only provenance for this assignment. Press Escape to close.</p>
          <div className="mt-4 max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {loading && <p className="rounded-md bg-gray-50 p-4 text-sm text-gray-600">Loading read-only evidence…</p>}
            {!loading && error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Evidence audit could not be read: {error}</p>}
            {!loading && !error && audit && (
              <>
                <section className="rounded-md border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">Scoring boundary</h3>
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="font-medium text-gray-500">First-page event</dt><dd className="break-words text-gray-900">{audit.firstPage ? `${audit.firstPage.id} · ${new Date(audit.firstPage.timestamp).toLocaleString()} · ${audit.firstPage.details}` : 'No first nurse page recorded'}</dd></div>
                    <div><dt className="font-medium text-gray-500">Scoring starts at</dt><dd className="text-gray-900">{audit.assignment.scoring_start_at ? new Date(audit.assignment.scoring_start_at).toLocaleString() : 'Not recorded'}</dd></div>
                  </dl>
                </section>
                <section className="rounded-md border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">Feedback provenance</h3>
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="font-medium text-gray-500">Status / error</dt><dd className="text-gray-900">{audit.assignment.feedback_status ?? 'Not recorded'}{audit.assignment.feedback_error ? ` — ${audit.assignment.feedback_error}` : ''}</dd></div>
                    <div><dt className="font-medium text-gray-500">Technical incomplete</dt><dd className="text-gray-900">{audit.assignment.technical_incomplete ? 'Yes' : 'No'}</dd></div>
                    <div><dt className="font-medium text-gray-500">Rubric / case key / assessment</dt><dd className="break-words text-gray-900">{audit.assignment.rubric_version ?? '—'} / {audit.assignment.case_key_version ?? '—'} / {audit.assignment.assessment_version ?? '—'}</dd></div>
                    <div><dt className="font-medium text-gray-500">Source event IDs</dt><dd className="break-words text-gray-900">{json(audit.assignment.source_event_ids)}</dd></div>
                  </dl>
                  <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><h4 className="font-semibold text-gray-600">Feedback debrief</h4><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2">{json(audit.assignment.feedback_debrief)}</pre></div><div><h4 className="font-semibold text-gray-600">Communication / MDM / safety</h4><pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2">{json({ communication: audit.assignment.communication_breakdown, mdm: audit.assignment.mdm_breakdown, safety: audit.assignment.safety_result })}</pre></div></div>
                </section>
                <section className="rounded-md border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">Latest feedback assessment run</h3>
                  {!audit.latestRun ? <p className="mt-2 text-sm text-amber-700">No assessment run was recorded.</p> : <div className="mt-2 text-sm"><p><span className="font-medium">Run:</span> {audit.latestRun.id} · {new Date(audit.latestRun.created_at).toLocaleString()}</p><p><span className="font-medium">Attempt:</span> {audit.latestRun.attempt_id} · <span className="font-medium">Boundary:</span> {audit.latestRun.scoring_start_at ?? 'Not recorded'} · <span className="font-medium">Incomplete:</span> {audit.latestRun.technical_incomplete ? 'Yes' : 'No'}</p><p><span className="font-medium">Rubric / case key / assessment:</span> {audit.latestRun.rubric_version} / {audit.latestRun.case_key_version} / {audit.latestRun.assessment_version}</p><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{json({ source_event_ids: audit.latestRun.source_event_ids, result: audit.latestRun.result })}</pre></div>}
                </section>
                <section className="rounded-md border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900">Post-page clinical evidence ({audit.events.length})</h3>
                  {audit.events.length === 0 ? <p className="mt-2 text-sm text-amber-700">No assignment-scoped clinical evidence was recorded at or after the scoring boundary.</p> : <div className="mt-2 space-y-2">{audit.events.map((event) => <div key={`${event.id}-${event.timestamp}`} className="rounded border border-gray-100 bg-gray-50 p-2 text-sm"><div className="font-medium text-gray-900">{event.type} · {event.id}</div><div className="text-xs text-gray-500">{new Date(event.timestamp).toLocaleString()}</div><div className="mt-1 whitespace-pre-wrap text-gray-700">{event.details || 'No details recorded'}</div></div>)}</div>}
                </section>
              </>
            )}
          </div>
          <div className="mt-5 flex justify-end">{close}</div>
        </div>
      </div>
    </div>
  );
}
