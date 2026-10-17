import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_YEAR = Number(process.env.TARGET_YEAR || '2026');
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || '4'));
const LIMIT = process.env.LIMIT ? Math.max(1, Number(process.env.LIMIT)) : null;
const STATUSES = (process.env.STATUSES || 'completed,bedside')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const DRY_RUN = process.env.DRY_RUN === '1';
const CONFIRM = process.env.CONFIRM === 'YES';
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-feedback`;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!Number.isInteger(TARGET_YEAR) || TARGET_YEAR < 2020 || TARGET_YEAR > 2100) {
  console.error(`Invalid TARGET_YEAR: ${process.env.TARGET_YEAR}`);
  process.exit(1);
}

if (!DRY_RUN && !CONFIRM) {
  console.error('Refusing to run without CONFIRM=YES. Set DRY_RUN=1 for a non-mutating preview.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const start = `${TARGET_YEAR}-01-01T00:00:00Z`;
const end = `${TARGET_YEAR + 1}-01-01T00:00:00Z`;

async function fetchAssignments() {
  const assignments = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('student_room_assignments')
      .select('id, status, feedback_status, created_at')
      .gte('created_at', start)
      .lt('created_at', end)
      .in('status', STATUSES)
      .order('created_at', { ascending: true })
      .range(from, from + 999);

    if (error) throw error;
    if (!data || data.length === 0) break;

    assignments.push(...data);
    if (LIMIT && assignments.length >= LIMIT) {
      return assignments.slice(0, LIMIT);
    }
    from += data.length;
  }

  return assignments;
}

async function resetAssignment(assignmentId) {
  const { error } = await supabase
    .from('student_room_assignments')
    .update({
      feedback_status: 'pending',
      feedback_error: null,
      nurse_feedback: null,
      feedback_generated_at: null,
    })
    .eq('id', assignmentId);

  if (error) throw error;
}

async function regenerateFeedback(assignmentId) {
  await resetAssignment(assignmentId);

  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ assignmentId }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Unknown edge function failure');
  }
}

async function main() {
  console.log(`Fetching ${TARGET_YEAR} assignments with statuses: ${STATUSES.join(', ')}`);
  const assignments = await fetchAssignments();

  const byStatus = {};
  const byFeedbackStatus = {};
  for (const assignment of assignments) {
    byStatus[assignment.status] = (byStatus[assignment.status] || 0) + 1;
    byFeedbackStatus[assignment.feedback_status || 'null'] =
      (byFeedbackStatus[assignment.feedback_status || 'null'] || 0) + 1;
  }

  console.log(`Window: ${start} -> ${end}`);
  console.log(`Assignments queued: ${assignments.length}`);
  console.log(`Status counts: ${JSON.stringify(byStatus)}`);
  console.log(`Feedback status counts: ${JSON.stringify(byFeedbackStatus)}`);
  console.log(`Concurrency: ${CONCURRENCY}`);

  if (DRY_RUN) {
    console.log('Dry run only. Exiting without changes.');
    return;
  }

  let cursor = 0;
  let successCount = 0;
  let errorCount = 0;

  async function worker(workerId) {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;

      if (currentIndex >= assignments.length) {
        return;
      }

      const assignment = assignments[currentIndex];
      const label = `[${currentIndex + 1}/${assignments.length}] worker:${workerId} assignment:${assignment.id}`;

      try {
        await regenerateFeedback(assignment.id);
        successCount += 1;
        console.log(`${label} ok`);
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${label} failed: ${message}`);
      }

      if ((successCount + errorCount) % 25 === 0 || successCount + errorCount === assignments.length) {
        console.log(
          `Progress ${successCount + errorCount}/${assignments.length} | success=${successCount} error=${errorCount}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, index) => worker(index + 1)));
  console.log(`Done. success=${successCount} error=${errorCount} total=${assignments.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
