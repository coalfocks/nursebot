import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';
import { corsHeaders } from '../_shared/cors.ts';

type Role = 'student' | 'test_user' | 'school_admin' | 'super_admin';

type SchoolSummary = {
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  students: number;
  testUsers: number;
  admins: number;
  activeRooms: number;
  assignmentsTotal: number;
  assignmentsCompleted: number;
};

type RecentAssignment = {
  id: string;
  createdAt: string;
  status: string;
  feedbackStatus: string | null;
  grade: number | null;
  schoolId: string | null;
  studentName: string | null;
  roomNumber: string | null;
};

type AssignmentEvaluationRow = {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  effectiveDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  completedAt: string | null;
  status: string | null;
  feedbackStatus: string | null;
  feedbackGeneratedAt: string | null;
  feedbackError: string | null;
  grade: number | null;
  diagnosis: string | null;
  treatmentPlan: string[] | null;
  school: {
    id: string;
    name: string;
    slug: string;
  } | null;
  room: {
    id: number;
    roomNumber: string;
    role: string | null;
    specialty: string | null;
  } | null;
  student: {
    id: string;
    fullName: string | null;
    email: string | null;
    role: string | null;
    schoolId: string | null;
  } | null;
  assignedBy: {
    id: string;
    fullName: string | null;
    email: string | null;
    role: string | null;
  } | null;
};

const asRole = (value: string | null): Role | null => {
  if (
    value === 'student' ||
    value === 'test_user' ||
    value === 'school_admin' ||
    value === 'super_admin'
  ) {
    return value;
  }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error('Missing required Supabase environment variables');
    }

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: requesterProfile, error: requesterProfileError } = await serviceClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (requesterProfileError || requesterProfile?.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [schoolsRes, profilesRes, roomsRes, assignmentsRes, recentAssignmentsRes, evaluationAssignmentsRes] = await Promise.all([
      serviceClient.from('schools').select('id, name, slug'),
      serviceClient.from('profiles').select('id, school_id, role'),
      serviceClient.from('rooms').select('id, school_id, is_active'),
      serviceClient.from('student_room_assignments').select('id, school_id, status, feedback_status'),
      serviceClient
        .from('student_room_assignments')
        .select(
          `
            id,
            created_at,
            status,
            feedback_status,
            grade,
            school_id,
            student:student_id ( full_name ),
            room:room_id ( room_number )
          `,
        )
        .order('created_at', { ascending: false })
        .limit(20),
      serviceClient
        .from('student_room_assignments')
        .select(
          `
            id,
            created_at,
            updated_at,
            effective_date,
            window_start,
            window_end,
            completed_at,
            status,
            feedback_status,
            feedback_generated_at,
            feedback_error,
            grade,
            diagnosis,
            treatment_plan,
            school:school_id ( id, name, slug ),
            room:room_id ( id, room_number, role, specialty:specialty_id ( name ) ),
            student:student_id ( id, full_name, email, role, school_id ),
            assigned_by_profile:assigned_by ( id, full_name, email, role )
          `,
        )
        .order('created_at', { ascending: false })
        .limit(150),
    ]);

    if (schoolsRes.error) throw schoolsRes.error;
    if (profilesRes.error) throw profilesRes.error;
    if (roomsRes.error) throw roomsRes.error;
    if (assignmentsRes.error) throw assignmentsRes.error;
    if (recentAssignmentsRes.error) throw recentAssignmentsRes.error;
    if (evaluationAssignmentsRes.error) throw evaluationAssignmentsRes.error;

    const schools = schoolsRes.data ?? [];
    const profiles = profilesRes.data ?? [];
    const rooms = roomsRes.data ?? [];
    const assignments = assignmentsRes.data ?? [];

    const schoolSummaries = new Map<string, SchoolSummary>();
    for (const school of schools) {
      schoolSummaries.set(school.id, {
        schoolId: school.id,
        schoolName: school.name,
        schoolSlug: school.slug,
        students: 0,
        testUsers: 0,
        admins: 0,
        activeRooms: 0,
        assignmentsTotal: 0,
        assignmentsCompleted: 0,
      });
    }

    for (const profile of profiles) {
      if (!profile.school_id) continue;
      const summary = schoolSummaries.get(profile.school_id);
      if (!summary) continue;

      const role = asRole(profile.role);
      if (role === 'student') summary.students += 1;
      if (role === 'test_user') summary.testUsers += 1;
      if (role === 'school_admin' || role === 'super_admin') summary.admins += 1;
    }

    for (const room of rooms) {
      if (!room.school_id || !room.is_active) continue;
      const summary = schoolSummaries.get(room.school_id);
      if (!summary) continue;
      summary.activeRooms += 1;
    }

    let pendingFeedback = 0;
    for (const assignment of assignments) {
      if (assignment.feedback_status === 'pending') pendingFeedback += 1;
      if (!assignment.school_id) continue;
      const summary = schoolSummaries.get(assignment.school_id);
      if (!summary) continue;

      summary.assignmentsTotal += 1;
      if (assignment.status === 'completed' || assignment.status === 'bedside') {
        summary.assignmentsCompleted += 1;
      }
    }

    const recentAssignments: RecentAssignment[] = (recentAssignmentsRes.data ?? []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      status: row.status,
      feedbackStatus: row.feedback_status,
      grade: row.grade,
      schoolId: row.school_id,
      studentName: row.student?.full_name ?? null,
      roomNumber: row.room?.room_number ?? null,
    }));

    const assignmentEvaluationRows: AssignmentEvaluationRow[] = (evaluationAssignmentsRes.data ?? []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      effectiveDate: row.effective_date,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      completedAt: row.completed_at,
      status: row.status,
      feedbackStatus: row.feedback_status,
      feedbackGeneratedAt: row.feedback_generated_at,
      feedbackError: row.feedback_error,
      grade: row.grade,
      diagnosis: row.diagnosis,
      treatmentPlan: row.treatment_plan,
      school: row.school
        ? {
            id: row.school.id,
            name: row.school.name,
            slug: row.school.slug,
          }
        : null,
      room: row.room
        ? {
            id: row.room.id,
            roomNumber: row.room.room_number,
            role: row.room.role,
            specialty: row.room.specialty?.name ?? null,
          }
        : null,
      student: row.student
        ? {
            id: row.student.id,
            fullName: row.student.full_name,
            email: row.student.email,
            role: row.student.role,
            schoolId: row.student.school_id,
          }
        : null,
      assignedBy: row.assigned_by_profile
        ? {
            id: row.assigned_by_profile.id,
            fullName: row.assigned_by_profile.full_name,
            email: row.assigned_by_profile.email,
            role: row.assigned_by_profile.role,
          }
        : null,
    }));

    const response = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalSchools: schools.length,
        totalStudents: profiles.filter((profile) => profile.role === 'student').length,
        totalTestUsers: profiles.filter((profile) => profile.role === 'test_user').length,
        totalAdmins: profiles.filter((profile) => profile.role === 'school_admin' || profile.role === 'super_admin')
          .length,
        totalRooms: rooms.length,
        activeRooms: rooms.filter((room) => room.is_active).length,
        totalAssignments: assignments.length,
        completedAssignments: assignments.filter((assignment) =>
          assignment.status === 'completed' || assignment.status === 'bedside'
        ).length,
        feedbackPending: pendingFeedback,
      },
      schools: Array.from(schoolSummaries.values()).sort((a, b) => a.schoolName.localeCompare(b.schoolName)),
      recentAssignments,
      assignmentEvaluationRows,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('superadmin-report failed', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unexpected error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
