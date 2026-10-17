import { createClient } from '@supabase/supabase-js';

// Opt-in live QA only. This script writes short-lived rows to the supplied
// assignment, verifies them, and removes them in finally. It must not be run
// against production or an account whose history must be preserved.
const requiredEnvironment = [
  'PATIENT_CHAT_QA_SUPABASE_URL',
  'PATIENT_CHAT_QA_ANON_KEY',
  'PATIENT_CHAT_QA_SERVICE_ROLE_KEY',
  'PATIENT_CHAT_QA_EMAIL',
  'PATIENT_CHAT_QA_PASSWORD',
  'PATIENT_CHAT_QA_ASSIGNMENT_ID',
];

const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
}
if (process.env.PATIENT_CHAT_QA_CONFIRM_DISPOSABLE_ACCOUNT !== 'yes') {
  throw new Error(
    'Set PATIENT_CHAT_QA_CONFIRM_DISPOSABLE_ACCOUNT=yes only for a disposable QA account and non-production project.',
  );
}

const supabaseUrl = process.env.PATIENT_CHAT_QA_SUPABASE_URL;
const anonKey = process.env.PATIENT_CHAT_QA_ANON_KEY;
const serviceRoleKey = process.env.PATIENT_CHAT_QA_SERVICE_ROLE_KEY;
const email = process.env.PATIENT_CHAT_QA_EMAIL;
const password = process.env.PATIENT_CHAT_QA_PASSWORD;
const assignmentId = process.env.PATIENT_CHAT_QA_ASSIGNMENT_ID;
const clientMessageId = crypto.randomUUID();
const question = `QA idempotency probe ${clientMessageId}: How are you feeling right now?`;

const authClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const invokePatientChat = async (accessToken) => {
  const response = await fetch(`${supabaseUrl}/functions/v1/patient-chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assignmentId,
      clientMessageId,
      messages: [{ role: 'user', content: question }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
};

const submitPatientQuestion = async (accessToken) => {
  const { error: questionError } = await authClient.from('patient_chat_messages').insert({
    assignment_id: assignmentId,
    client_message_id: clientMessageId,
    role: 'student',
    content: question,
  });
  if (questionError && questionError.code !== '23505') throw questionError;
  return invokePatientChat(accessToken);
};

const countRows = async (table, configureQuery) => {
  const { count, error } = await configureQuery(
    adminClient.from(table).select('*', { count: 'exact', head: true }),
  );
  if (error) throw error;
  return count ?? 0;
};

const waitForCompletedLedger = async () => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const { data, error } = await adminClient
      .from('patient_chat_requests')
      .select('id, status, response_content, response_role')
      .eq('assignment_id', assignmentId)
      .eq('client_message_id', clientMessageId)
      .maybeSingle();
    if (error) throw error;
    if (data?.status === 'completed') return data;
    if (data?.status === 'failed') throw new Error('The claimed request failed before completion');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the request ledger row to complete');
};

const cleanup = async () => {
  const filters = [
    adminClient
      .from('patient_chat_messages')
      .delete()
      .eq('assignment_id', assignmentId)
      .eq('reply_to_client_message_id', clientMessageId),
    adminClient
      .from('patient_chat_messages')
      .delete()
      .eq('assignment_id', assignmentId)
      .eq('client_message_id', clientMessageId),
    adminClient
      .from('patient_chat_requests')
      .delete()
      .eq('assignment_id', assignmentId)
      .eq('client_message_id', clientMessageId),
  ];
  const results = await Promise.all(filters);
  const cleanupError = results.find(({ error }) => error)?.error;
  if (cleanupError) console.error('QA cleanup failed:', cleanupError.message);
};

try {
  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({ email, password });
  if (authError || !authData.session) throw authError ?? new Error('QA sign-in returned no session');

  const { data: assignment, error: assignmentError } = await adminClient
    .from('student_room_assignments')
    .select('id, student_id')
    .eq('id', assignmentId)
    .eq('student_id', authData.user.id)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  assert(assignment, 'The QA assignment does not belong to the disposable QA account');

  const concurrentResults = await Promise.all([
    submitPatientQuestion(authData.session.access_token),
    submitPatientQuestion(authData.session.access_token),
  ]);
  assert(
    concurrentResults.every(({ status }) => status === 200 || status === 409),
    `Unexpected concurrent response statuses: ${concurrentResults.map(({ status }) => status).join(', ')}`,
  );
  assert(
    concurrentResults.some(({ status }) => status === 200),
    `Neither concurrent invocation completed: ${concurrentResults.map(({ status }) => status).join(', ')}`,
  );

  const ledger = await waitForCompletedLedger();
  const retryResult = await invokePatientChat(authData.session.access_token);
  assert(retryResult.status === 200, `Same-key retry returned HTTP ${retryResult.status}`);
  assert(retryResult.body.replayed === true, 'Same-key retry was not identified as a replay');
  assert(retryResult.body.message === ledger.response_content, 'Replay content differs from the ledger response');

  const [studentRows, replyRows, ledgerRows] = await Promise.all([
    countRows('patient_chat_messages', (query) => query
      .eq('assignment_id', assignmentId)
      .eq('client_message_id', clientMessageId)
      .eq('role', 'student')),
    countRows('patient_chat_messages', (query) => query
      .eq('assignment_id', assignmentId)
      .eq('reply_to_client_message_id', clientMessageId)
      .in('role', ['patient', 'caregiver'])),
    countRows('patient_chat_requests', (query) => query
      .eq('assignment_id', assignmentId)
      .eq('client_message_id', clientMessageId)
      .eq('status', 'completed')),
  ]);

  assert(studentRows === 1, `Expected one student row, found ${studentRows}`);
  assert(replyRows === 1, `Expected one patient/caregiver reply row, found ${replyRows}`);
  assert(ledgerRows === 1, `Expected one completed request ledger row, found ${ledgerRows}`);

  console.log('PASS: concurrent same-key calls and retry produced 1 student row, 1 reply, and 1 completed ledger row.');
  console.log(`Concurrent statuses: ${concurrentResults.map(({ status }) => status).join(', ')}; retry status: ${retryResult.status}.`);
  console.log('Exactly-once boundary: persisted reply and ledger completion are verified; provider calls are not independently countable without provider instrumentation.');
} finally {
  await cleanup();
  await authClient.auth.signOut();
}
