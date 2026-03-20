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
  studentProgressNote: string | null;
  learningObjectives: string | null;
  communicationScore: number | null;
  mdmScore: number | null;
  communicationBreakdown: unknown;
  mdmBreakdown: unknown;
  nurseFeedback: unknown;
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

type TimelineExportRequest = {
  action?: string;
  assignmentId?: string;
};

type TimelineAssignmentRow = {
  id: string;
  created_at: string | null;
  completed_at: string | null;
  status: string | null;
  student_progress_note: string | null;
  room_id: number;
  room: {
    id: number;
    room_number: string;
    role: string | null;
    patient_id: string | null;
    specialty: { name: string | null } | null;
  } | null;
  school: {
    id: string;
    name: string;
    slug: string;
  } | null;
  student: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
  assigned_by_profile: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
};

type TimelineChatMessageRow = {
  id: string | number | null;
  assignment_id: string | null;
  role: string;
  content: string;
  created_at: string | null;
};

type TimelineOrderRow = {
  id: string;
  assignment_id: string | null;
  room_id: number | null;
  override_scope: string | null;
  category: string;
  order_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  priority: string | null;
  status: string | null;
  instructions: string | null;
  order_time: string | null;
  created_at: string | null;
  deleted_at: string | null;
};

type TimelineLabRow = {
  id: string;
  assignment_id: string | null;
  room_id: number | null;
  override_scope: string | null;
  test_name: string;
  value: number | null;
  unit: string | null;
  status: string | null;
  collection_time: string | null;
  result_time: string | null;
  created_at: string | null;
  deleted_at: string | null;
};

type TimelineVitalRow = {
  id: string;
  assignment_id: string | null;
  room_id: number | null;
  override_scope: string | null;
  timestamp: string | null;
  temperature: number | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  heart_rate: number | null;
  respiratory_rate: number | null;
  oxygen_saturation: number | null;
  pain: number | null;
  deleted_at: string | null;
};

type TimelineImagingRow = {
  id: string;
  assignment_id: string | null;
  room_id: number | null;
  override_scope: string | null;
  order_name: string | null;
  study_type: string;
  status: string | null;
  report: string | null;
  order_time: string | null;
  report_generated_at: string | null;
  created_at: string | null;
  deleted_at: string | null;
};

type TimelineEvent = {
  id: string;
  kind: 'message' | 'completion' | 'order' | 'labs' | 'vital' | 'imaging' | 'progress-note';
  timestamp: string;
  title: string;
  body?: string;
  meta?: string[];
};

const BASELINE_SENTINEL_PREFIX = '2000-01-01';
const TIMELINE_EXPORT_PAGE_SIZE = 1000;

const fetchAllPages = async <T>(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> => {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + TIMELINE_EXPORT_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      throw new Error(error.message);
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < TIMELINE_EXPORT_PAGE_SIZE) {
      break;
    }
    from += TIMELINE_EXPORT_PAGE_SIZE;
  }

  return rows;
};

const normalizeTimestamp = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const deriveScope = (
  overrideScope: string | null | undefined,
  assignmentId?: string | null,
  roomId?: number | null,
): 'baseline' | 'room' | 'assignment' => {
  if (overrideScope === 'assignment' || overrideScope === 'room' || overrideScope === 'baseline') {
    return overrideScope;
  }
  if (assignmentId) return 'assignment';
  if (roomId) return 'room';
  return 'baseline';
};

const scopeMatchesContext = (
  scope: 'baseline' | 'room' | 'assignment',
  rowRoomId: number | null,
  targetRoomIds: number[] | null,
  rowAssignmentId?: string | null,
  targetAssignmentId?: string | null,
) => {
  if (scope === 'assignment') {
    return Boolean(targetAssignmentId && rowAssignmentId === targetAssignmentId);
  }
  if (scope === 'room') {
    if (!targetRoomIds || targetRoomIds.length === 0) return true;
    return targetRoomIds.includes(rowRoomId ?? -1);
  }
  return true;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatDisplayTimestamp = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'assignment';

const renderMeta = (meta?: string[]) => {
  if (!meta?.length) return '';
  return `<div class="meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`;
};

const getEventClassName = (kind: TimelineEvent['kind']) => {
  switch (kind) {
    case 'message':
      return 'event message';
    case 'completion':
      return 'event completion';
    case 'order':
      return 'event order';
    case 'labs':
      return 'event labs';
    case 'vital':
      return 'event vital';
    case 'imaging':
      return 'event imaging';
    case 'progress-note':
      return 'event note';
    default:
      return 'event';
  }
};

const getEventBadge = (kind: TimelineEvent['kind']) => {
  switch (kind) {
    case 'message':
      return 'MSG';
    case 'completion':
      return 'END';
    case 'order':
      return 'ORD';
    case 'labs':
      return 'LAB';
    case 'vital':
      return 'VIT';
    case 'imaging':
      return 'IMG';
    case 'progress-note':
      return 'NOTE';
    default:
      return 'EVT';
  }
};

const buildTimelineExportHtml = (
  assignment: TimelineAssignmentRow,
  events: TimelineEvent[],
) => {
  const studentName = assignment.student?.full_name ?? 'Unknown Student';
  const roomNumber = assignment.room?.room_number ?? 'Unknown Room';
  const schoolName = assignment.school?.name ?? 'Unknown School';
  const assignedBy = assignment.assigned_by_profile?.full_name ?? 'Unknown';
  const headerMeta = [
    `Student: ${studentName}`,
    `Room: ${roomNumber}`,
    `School: ${schoolName}`,
    `Assigned By: ${assignedBy}`,
    `Status: ${assignment.status ?? '—'}`,
  ];

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Assignment Timeline Export</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --card: #ffffff;
        --line: #d7deeb;
        --text: #0f172a;
        --muted: #475569;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: radial-gradient(circle at top, #eef4ff, var(--bg) 45%);
        color: var(--text);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .wrap {
        max-width: 1040px;
        margin: 0 auto;
        padding: 32px 24px 64px;
      }
      .hero {
        background: linear-gradient(135deg, #0f172a, #1e3a8a);
        color: white;
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.22);
      }
      .hero h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.1;
      }
      .hero p {
        margin: 10px 0 0;
        color: rgba(255,255,255,0.82);
      }
      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }
      .hero-meta span, .meta span {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255,255,255,0.14);
        font-size: 12px;
      }
      .timeline {
        position: relative;
        margin-top: 28px;
        padding-left: 54px;
      }
      .timeline::before {
        content: "";
        position: absolute;
        left: 18px;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--line);
      }
      .entry {
        position: relative;
        margin-bottom: 18px;
      }
      .badge {
        position: absolute;
        left: -54px;
        top: 18px;
        width: 38px;
        height: 38px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.16em;
        border: 1px solid var(--line);
        background: white;
        color: #334155;
      }
      .event {
        background: var(--card);
        border: 1px solid #d8e0ec;
        border-radius: 20px;
        padding: 16px 18px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
      }
      .event h2 {
        margin: 0;
        font-size: 16px;
      }
      .event .timestamp {
        margin-top: 2px;
        color: var(--muted);
        font-size: 12px;
      }
      .event p {
        margin: 10px 0 0;
        white-space: pre-wrap;
        line-height: 1.6;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .meta span {
        background: #eef2ff;
        color: #334155;
      }
      .message .meta span { background: #f1f5f9; }
      .order { border-color: #bfdbfe; }
      .labs { border-color: #bbf7d0; }
      .vital { border-color: #fecdd3; }
      .imaging { border-color: #ddd6fe; }
      .completion { border-color: #bbf7d0; background: #f0fdf4; }
      .note {
        border-color: #fcd34d;
        background: #fef3c7;
        transform: rotate(-0.4deg);
      }
      .note .meta span { background: rgba(255,255,255,0.48); }
      @media print {
        body { background: white; }
        .wrap { padding: 0; }
        .hero { box-shadow: none; }
        .event { box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="hero">
        <h1>Assignment Timeline Export</h1>
        <p>${escapeHtml(studentName)} in Room ${escapeHtml(roomNumber)}</p>
        <div class="hero-meta">
          ${headerMeta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>
      </section>
      <section class="timeline">
        ${events
          .map(
            (event) => `<article class="entry">
              <div class="badge">${getEventBadge(event.kind)}</div>
              <div class="${getEventClassName(event.kind)}">
                <h2>${escapeHtml(event.title)}</h2>
                <div class="timestamp">${escapeHtml(formatDisplayTimestamp(event.timestamp))}</div>
                ${event.body ? `<p>${escapeHtml(event.body)}</p>` : ''}
                ${renderMeta(event.meta)}
              </div>
            </article>`,
          )
          .join('')}
      </section>
    </div>
  </body>
</html>`;
};

const getRoomLineage = async (
  serviceClient: ReturnType<typeof createClient>,
  roomId?: number | null,
) => {
  if (!roomId) return null;
  const visited = new Set<number>();
  const lineage: number[] = [];
  let current: number | null | undefined = roomId;

  while (current && !visited.has(current)) {
    visited.add(current);
    lineage.push(current);
    const { data, error } = await serviceClient
      .from('rooms')
      .select('continues_from')
      .eq('id', current)
      .maybeSingle();
    if (error) throw error;
    current = data?.continues_from ?? null;
  }

  return lineage;
};

const buildTimelineExport = async (
  serviceClient: ReturnType<typeof createClient>,
  assignmentId: string,
) => {
  const { data: assignmentData, error: assignmentError } = await serviceClient
    .from('student_room_assignments')
    .select(
      `
        id,
        created_at,
        completed_at,
        status,
        student_progress_note,
        room_id,
        room:room_id ( id, room_number, role, patient_id, specialty:specialty_id ( name ) ),
        school:school_id ( id, name, slug ),
        student:student_id ( id, full_name, email ),
        assigned_by_profile:assigned_by ( id, full_name, email )
      `,
    )
    .eq('id', assignmentId)
    .maybeSingle();

  if (assignmentError) throw assignmentError;
  if (!assignmentData) {
    throw new Error('Assignment not found');
  }

  const assignment = assignmentData as TimelineAssignmentRow;
  const targetRooms = await getRoomLineage(serviceClient, assignment.room_id);

  const messagesData = await fetchAllPages<TimelineChatMessageRow>((from, to) =>
    serviceClient
      .from('chat_messages')
      .select('id, assignment_id, role, content, created_at')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );

  const patientId = assignment.room?.patient_id ?? null;
  let ordersData: TimelineOrderRow[] = [];
  let labsData: TimelineLabRow[] = [];
  let vitalsData: TimelineVitalRow[] = [];
  let imagingData: TimelineImagingRow[] = [];

  if (patientId) {
    const [ordersRows, labsRows, vitalsRows, imagingRows] = await Promise.all([
      fetchAllPages<TimelineOrderRow>((from, to) =>
        serviceClient
          .from('medical_orders')
          .select(
            'id, assignment_id, room_id, override_scope, category, order_name, dose, route, frequency, priority, status, instructions, order_time, created_at, deleted_at',
          )
          .eq('patient_id', patientId)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllPages<TimelineLabRow>((from, to) =>
        serviceClient
          .from('lab_results')
          .select(
            'id, assignment_id, room_id, override_scope, test_name, value, unit, status, collection_time, result_time, created_at, deleted_at',
          )
          .eq('patient_id', patientId)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllPages<TimelineVitalRow>((from, to) =>
        serviceClient
          .from('vital_signs')
          .select(
            'id, assignment_id, room_id, override_scope, timestamp, temperature, blood_pressure_systolic, blood_pressure_diastolic, heart_rate, respiratory_rate, oxygen_saturation, pain, deleted_at',
          )
          .eq('patient_id', patientId)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllPages<TimelineImagingRow>((from, to) =>
        serviceClient
          .from('imaging_studies')
          .select(
            'id, assignment_id, room_id, override_scope, order_name, study_type, status, report, order_time, report_generated_at, created_at, deleted_at',
          )
          .eq('patient_id', patientId)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ]);

    ordersData = ordersRows;
    labsData = labsRows;
    vitalsData = vitalsRows;
    imagingData = imagingRows;
  }

  const events: TimelineEvent[] = [];

  for (const message of messagesData) {
    const timestamp = normalizeTimestamp(message.created_at);
    if (!timestamp) continue;
    if (message.content === '<completed>' && message.role === 'assistant') {
      events.push({
        id: `completion-${message.id ?? timestamp}`,
        kind: 'completion',
        timestamp,
        title: 'Case completed',
      });
      continue;
    }
    events.push({
      id: `message-${message.id ?? `${message.assignment_id ?? assignmentId}-${timestamp}`}`,
      kind: 'message',
      timestamp,
      title: message.role === 'student' ? 'Student message' : 'Nurse message',
      body: message.content,
      meta: [message.role === 'student' ? 'Author: Student' : 'Author: Nurse'],
    });
  }

  const filteredOrders = ordersData.filter((row) =>
    scopeMatchesContext(
      deriveScope(row.override_scope, row.assignment_id, row.room_id),
      row.room_id,
      targetRooms,
      row.assignment_id,
      assignmentId,
    ),
  );

  for (const order of filteredOrders) {
    const timestamp = normalizeTimestamp(order.order_time ?? order.created_at);
    if (!timestamp) continue;
    const details = [order.dose, order.route, order.frequency].filter(Boolean).join(' • ');
    events.push({
      id: `order-${order.id}`,
      kind: 'order',
      timestamp,
      title: order.order_name,
      body: details || order.instructions || undefined,
      meta: [order.category, order.priority ?? 'Routine', order.status ?? 'Active'],
    });
  }

  const filteredLabs = labsData.filter((row) =>
    scopeMatchesContext(
      deriveScope(row.override_scope, row.assignment_id, row.room_id),
      row.room_id,
      targetRooms,
      row.assignment_id,
      assignmentId,
    ),
  );

  const groupedLabs = new Map<string, TimelineLabRow[]>();
  for (const lab of filteredLabs) {
    const primary = normalizeTimestamp(lab.result_time ?? lab.collection_time ?? lab.created_at);
    const timestamp =
      primary?.startsWith(BASELINE_SENTINEL_PREFIX)
        ? normalizeTimestamp(lab.created_at) ?? primary
        : primary;
    if (!timestamp) continue;
    const key = `${deriveScope(lab.override_scope, lab.assignment_id, lab.room_id)}-${timestamp.slice(0, 16)}`;
    const existing = groupedLabs.get(key) ?? [];
    existing.push(lab);
    groupedLabs.set(key, existing);
  }

  groupedLabs.forEach((group, key) => {
    const first = group[0];
    const timestamp = normalizeTimestamp(first.result_time ?? first.collection_time ?? first.created_at);
    const displayTimestamp =
      timestamp?.startsWith(BASELINE_SENTINEL_PREFIX)
        ? normalizeTimestamp(first.created_at) ?? timestamp
        : timestamp;
    if (!displayTimestamp) return;
    group.sort((a, b) => a.test_name.localeCompare(b.test_name));
    events.push({
      id: `labs-${key}`,
      kind: 'labs',
      timestamp: displayTimestamp,
      title: `Lab results (${group.length})`,
      body: group
        .map((lab) => {
          if (lab.status === 'Pending') return `${lab.test_name}: pending`;
          const unit = lab.unit ? ` ${lab.unit}` : '';
          const value = lab.value === null ? 'resulted' : `${lab.value}${unit}`;
          return `${lab.test_name}: ${value}`;
        })
        .join('\n'),
      meta: Array.from(new Set(group.map((lab) => lab.status ?? 'Unknown'))),
    });
  });

  const filteredVitals = vitalsData.filter((row) =>
    scopeMatchesContext(
      deriveScope(row.override_scope, row.assignment_id, row.room_id),
      row.room_id,
      targetRooms,
      row.assignment_id,
      assignmentId,
    ),
  );

  for (const vital of filteredVitals) {
    const timestamp = normalizeTimestamp(vital.timestamp);
    if (!timestamp) continue;
    const body = [
      vital.temperature !== null ? `T ${vital.temperature}` : null,
      vital.blood_pressure_systolic !== null && vital.blood_pressure_diastolic !== null
        ? `BP ${vital.blood_pressure_systolic}/${vital.blood_pressure_diastolic}`
        : null,
      vital.heart_rate !== null ? `HR ${vital.heart_rate}` : null,
      vital.respiratory_rate !== null ? `RR ${vital.respiratory_rate}` : null,
      vital.oxygen_saturation !== null ? `SpO2 ${vital.oxygen_saturation}%` : null,
      vital.pain !== null ? `Pain ${vital.pain}/10` : null,
    ]
      .filter(Boolean)
      .join(' • ');

    events.push({
      id: `vital-${vital.id}`,
      kind: 'vital',
      timestamp,
      title: 'Vitals updated',
      body: body || undefined,
    });
  }

  const filteredImaging = imagingData.filter((row) =>
    scopeMatchesContext(
      deriveScope(row.override_scope, row.assignment_id, row.room_id),
      row.room_id,
      targetRooms,
      row.assignment_id,
      assignmentId,
    ),
  );

  for (const imaging of filteredImaging) {
    const timestamp = normalizeTimestamp(imaging.report_generated_at ?? imaging.order_time ?? imaging.created_at);
    if (!timestamp) continue;
    events.push({
      id: `imaging-${imaging.id}`,
      kind: 'imaging',
      timestamp,
      title: imaging.order_name || imaging.study_type,
      body: imaging.report || undefined,
      meta: [imaging.study_type, imaging.status ?? 'Result available'],
    });
  }

  if (assignment.student_progress_note?.trim()) {
    const timestamp = normalizeTimestamp(assignment.completed_at) ?? new Date().toISOString();
    events.push({
      id: `progress-note-${assignment.id}`,
      kind: 'progress-note',
      timestamp,
      title: 'Student progress note',
      body: assignment.student_progress_note.trim(),
    });
  }

  events.sort((a, b) => {
    if (a.kind === 'progress-note' && b.kind !== 'progress-note') return 1;
    if (b.kind === 'progress-note' && a.kind !== 'progress-note') return -1;
    const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.kind.localeCompare(b.kind);
  });

  const studentName = assignment.student?.full_name ?? 'unknown-student';
  const roomNumber = assignment.room?.room_number ?? 'room';
  const fileName = `${slugify(studentName)}-${slugify(roomNumber)}-timeline.html`;

  return {
    assignmentId: assignment.id,
    fileName,
    html: buildTimelineExportHtml(assignment, events),
  };
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
    let payload: TimelineExportRequest | null = null;
    if (req.method === 'POST') {
      try {
        payload = (await req.json()) as TimelineExportRequest;
      } catch {
        payload = null;
      }
    }

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

    if (payload?.action === 'export_assignment_timeline') {
      if (!payload.assignmentId) {
        return new Response(JSON.stringify({ error: 'assignmentId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const timelineExport = await buildTimelineExport(serviceClient, payload.assignmentId);
      return new Response(JSON.stringify(timelineExport), {
        status: 200,
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
            student_progress_note,
            learning_objectives,
            communication_score,
            mdm_score,
            communication_breakdown,
            mdm_breakdown,
            nurse_feedback,
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
      studentProgressNote: row.student_progress_note,
      learningObjectives: row.learning_objectives,
      communicationScore: row.communication_score,
      mdmScore: row.mdm_score,
      communicationBreakdown: row.communication_breakdown,
      mdmBreakdown: row.mdm_breakdown,
      nurseFeedback: row.nurse_feedback,
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
