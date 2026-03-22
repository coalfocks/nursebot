import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';
import { corsHeaders } from '../_shared/cors.ts';
import { COMMUNICATION_SCORING, MDM_SCORING } from '../_shared/evaluation-prompts.ts';

type FeedbackSectionKey =
  | 'informationSharing'
  | 'responsiveCommunication'
  | 'efficiencyDeduction'
  | 'labsOrdersQuality'
  | 'noteThoughtProcess'
  | 'safetyDeduction';

type AssignmentRow = {
  id: string;
  completed_at: string | null;
  status: string | null;
  feedback_status: string | null;
  communication_score: number | null;
  mdm_score: number | null;
  communication_breakdown: unknown;
  mdm_breakdown: unknown;
  room: {
    room_number: string | null;
  } | null;
};

type MetricDefinition = {
  key: FeedbackSectionKey;
  label: string;
  anchors: number[];
  extract: (assignment: AssignmentRow) => number | null;
};

type AggregateMetric = {
  key: FeedbackSectionKey;
  label: string;
  count: number;
  average: number | null;
  roundedScore: number | null;
  feedback: string;
};

const allowedRoles = new Set(['student', 'test_user']);

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatDate = (value: string | null) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const parseObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const getNestedScore = (
  source: unknown,
  sectionKey: string,
): number | null => {
  const root = parseObject(source);
  if (!root) return null;
  const section = parseObject(root[sectionKey]);
  if (!section) return null;
  return parseNumber(section.score);
};

const roundToAnchor = (value: number, anchors: number[]) => {
  return anchors.reduce((best, current) => {
    const currentDistance = Math.abs(current - value);
    const bestDistance = Math.abs(best - value);
    if (currentDistance < bestDistance) return current;
    if (currentDistance === bestDistance && current > best) return current;
    return best;
  }, anchors[0]);
};

const getRubricFeedback = (key: FeedbackSectionKey, score: number | null) => {
  if (score == null) return 'No rubric feedback available (insufficient data).';

  if (key === 'informationSharing') {
    return COMMUNICATION_SCORING.informationSharing.scores[score as 0 | 1 | 2]?.feedback ?? 'No rubric feedback available.';
  }

  if (key === 'responsiveCommunication') {
    return COMMUNICATION_SCORING.responsiveCommunication.scores[score as 0 | 1 | 2 | 3]?.feedback ?? 'No rubric feedback available.';
  }

  if (key === 'efficiencyDeduction') {
    return COMMUNICATION_SCORING.efficiencyDeduction.scores[String(score) as '-2' | '-1' | '0']?.feedback ?? 'No rubric feedback available.';
  }

  if (key === 'labsOrdersQuality') {
    return MDM_SCORING.labsOrdersQuality.scores[score as 0 | 1 | 2 | 3]?.feedback ?? 'No rubric feedback available.';
  }

  if (key === 'noteThoughtProcess') {
    return MDM_SCORING.noteThoughtProcess.scores[score as 0 | 1 | 2]?.feedback ?? 'No rubric feedback available.';
  }

  return MDM_SCORING.safetyDeduction.scores[String(score) as '-2' | '-1' | '0']?.feedback ?? 'No rubric feedback available.';
};

const metricDefinitions: MetricDefinition[] = [
  {
    key: 'informationSharing',
    label: 'Avg Information Sharing',
    anchors: [0, 1, 2],
    extract: (assignment) => getNestedScore(assignment.communication_breakdown, 'information_sharing'),
  },
  {
    key: 'responsiveCommunication',
    label: 'Avg Responsive Communication',
    anchors: [0, 1, 2, 3],
    extract: (assignment) => getNestedScore(assignment.communication_breakdown, 'responsive_communication'),
  },
  {
    key: 'efficiencyDeduction',
    label: 'Avg Efficiency Deduction',
    anchors: [-2, -1, 0],
    extract: (assignment) => getNestedScore(assignment.communication_breakdown, 'efficiency_deduction'),
  },
  {
    key: 'labsOrdersQuality',
    label: 'Avg Labs/Orders Quality',
    anchors: [0, 1, 2, 3],
    extract: (assignment) => getNestedScore(assignment.mdm_breakdown, 'labs_orders_quality'),
  },
  {
    key: 'noteThoughtProcess',
    label: 'Avg Note Thought Process',
    anchors: [0, 1, 2],
    extract: (assignment) => getNestedScore(assignment.mdm_breakdown, 'note_thought_process'),
  },
  {
    key: 'safetyDeduction',
    label: 'Avg Safety Deduction',
    anchors: [-2, -1, 0],
    extract: (assignment) => getNestedScore(assignment.mdm_breakdown, 'safety_deduction'),
  },
];

const buildAggregateMetrics = (assignments: AssignmentRow[]): AggregateMetric[] => {
  return metricDefinitions.map((metric) => {
    const scores = assignments
      .map(metric.extract)
      .filter((value): value is number => value != null);

    const average = scores.length > 0
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null;

    const roundedScore = average == null
      ? null
      : roundToAnchor(average, metric.anchors);

    return {
      key: metric.key,
      label: metric.label,
      count: scores.length,
      average,
      roundedScore,
      feedback: getRubricFeedback(metric.key, roundedScore),
    };
  });
};

const scoreText = (value: number | null) => (value == null ? '--' : String(value));

const buildHtml = (
  studentName: string,
  assignments: AssignmentRow[],
  aggregates: AggregateMetric[],
) => {
  const completedCaseCount = assignments.length;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Student Aggregate Feedback Export</title>
    <style>
      :root {
        --bg: #f8fafc;
        --card: #ffffff;
        --text: #0f172a;
        --muted: #475569;
        --line: #dbe2ea;
        --accent: #1d4ed8;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px;
        background: linear-gradient(180deg, #eff6ff, var(--bg));
        color: var(--text);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .wrap { max-width: 1100px; margin: 0 auto; }
      .hero {
        background: linear-gradient(135deg, #0f172a, #1e40af);
        color: white;
        border-radius: 20px;
        padding: 24px;
        margin-bottom: 18px;
      }
      .hero h1 { margin: 0; font-size: 28px; }
      .hero p { margin: 8px 0 0; color: rgba(255, 255, 255, 0.88); }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 18px;
        margin-bottom: 16px;
      }
      h2 {
        font-size: 18px;
        margin: 0 0 12px;
      }
      .metric {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px;
        margin-bottom: 10px;
      }
      .metric h3 {
        margin: 0;
        font-size: 15px;
      }
      .metric-meta {
        margin-top: 6px;
        color: var(--muted);
        font-size: 13px;
      }
      .metric p {
        margin: 8px 0 0;
        font-size: 14px;
        line-height: 1.45;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      thead {
        background: #eff6ff;
      }
      th, td {
        border: 1px solid var(--line);
        padding: 8px;
        text-align: left;
        vertical-align: top;
      }
      th {
        font-size: 12px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: #334155;
      }
      .muted { color: var(--muted); }
      @media print {
        body { padding: 0; background: white; }
        .card, .hero { box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="hero">
        <h1>Aggregate Student Feedback</h1>
        <p>${escapeHtml(studentName)} · Completed Cases: ${completedCaseCount}</p>
      </section>

      <section class="card">
        <h2>Aggregate Subsection Averages</h2>
        ${aggregates
          .map(
            (metric) => `<article class="metric">
              <h3>${escapeHtml(metric.label)}</h3>
              <div class="metric-meta">
                Raw average: ${metric.average == null ? '--' : metric.average.toFixed(2)} · Rounded rubric score: ${scoreText(metric.roundedScore)} · Cases used: ${metric.count}
              </div>
              <p>${escapeHtml(metric.feedback)}</p>
            </article>`,
          )
          .join('')}
      </section>

      <section class="card">
        <h2>Individual Case Scores</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Room</th>
              <th>Comm</th>
              <th>MDM</th>
              <th>Info</th>
              <th>Responsive</th>
              <th>Efficiency</th>
              <th>Labs/Orders</th>
              <th>Thought Process</th>
              <th>Safety</th>
            </tr>
          </thead>
          <tbody>
            ${assignments
              .map((assignment) => {
                const info = getNestedScore(assignment.communication_breakdown, 'information_sharing');
                const responsive = getNestedScore(assignment.communication_breakdown, 'responsive_communication');
                const efficiency = getNestedScore(assignment.communication_breakdown, 'efficiency_deduction');
                const labs = getNestedScore(assignment.mdm_breakdown, 'labs_orders_quality');
                const thought = getNestedScore(assignment.mdm_breakdown, 'note_thought_process');
                const safety = getNestedScore(assignment.mdm_breakdown, 'safety_deduction');

                return `<tr>
                  <td>${escapeHtml(formatDate(assignment.completed_at))}</td>
                  <td>${escapeHtml(assignment.room?.room_number ?? '--')}</td>
                  <td>${scoreText(assignment.communication_score)}</td>
                  <td>${scoreText(assignment.mdm_score)}</td>
                  <td>${scoreText(info)}</td>
                  <td>${scoreText(responsive)}</td>
                  <td>${scoreText(efficiency)}</td>
                  <td>${scoreText(labs)}</td>
                  <td>${scoreText(thought)}</td>
                  <td>${scoreText(safety)}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
        <p class="muted">Only assignments with status completed/bedside and feedback status completed are included.</p>
      </section>
    </div>
  </body>
</html>`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
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

    const { data: profile, error: profileError } = await serviceClient
      .from('profiles')
      .select('full_name, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || !allowedRoles.has(profile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: assignmentRows, error: assignmentsError } = await serviceClient
      .from('student_room_assignments')
      .select(`
        id,
        completed_at,
        status,
        feedback_status,
        communication_score,
        mdm_score,
        communication_breakdown,
        mdm_breakdown,
        room:room_id ( room_number )
      `)
      .eq('student_id', user.id)
      .in('status', ['completed', 'bedside'])
      .eq('feedback_status', 'completed')
      .order('completed_at', { ascending: false });

    if (assignmentsError) {
      throw assignmentsError;
    }

    const assignments = (assignmentRows ?? []) as AssignmentRow[];
    const aggregates = buildAggregateMetrics(assignments);
    const studentName = profile.full_name?.trim() || user.email || 'Student';

    const html = buildHtml(studentName, assignments, aggregates);
    const fileSafeName = studentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'student';

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileSafeName}-aggregate-feedback.html"`,
      },
    });
  } catch (error) {
    console.error('student-feedback-export error', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
