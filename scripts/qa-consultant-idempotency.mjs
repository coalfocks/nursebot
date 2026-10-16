import { createClient } from '@supabase/supabase-js';

// Opt-in live QA only. Use a fresh, disposable synthetic active assignment.
const required = ['CONSULTANT_QA_SUPABASE_URL', 'CONSULTANT_QA_ANON_KEY', 'CONSULTANT_QA_SERVICE_ROLE_KEY', 'CONSULTANT_QA_EMAIL', 'CONSULTANT_QA_PASSWORD', 'CONSULTANT_QA_ASSIGNMENT_ID'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
if (process.env.CONSULTANT_QA_CONFIRM_DISPOSABLE_ACCOUNT !== 'yes') throw new Error('Set CONSULTANT_QA_CONFIRM_DISPOSABLE_ACCOUNT=yes for synthetic disposable QA only.');

const url = process.env.CONSULTANT_QA_SUPABASE_URL;
const anonKey = process.env.CONSULTANT_QA_ANON_KEY;
const serviceKey = process.env.CONSULTANT_QA_SERVICE_ROLE_KEY;
const assignmentId = process.env.CONSULTANT_QA_ASSIGNMENT_ID;
const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const requestId = crypto.randomUUID();
const request = { specialty: 'Medicine', summary: `Synthetic consultant QA ${requestId}`, clinicalQuestion: 'What monitoring and next step are appropriate?', reason: 'Synthetic idempotency verification', urgency: 'routine', clientRequestId: requestId };
const invoke = async (accessToken) => {
  const response = await fetch(`${url}/functions/v1/consultant-chat`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ assignmentId, request }) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

let orderId;
try {
  const { data: signedIn, error: authError } = await authClient.auth.signInWithPassword({ email: process.env.CONSULTANT_QA_EMAIL, password: process.env.CONSULTANT_QA_PASSWORD });
  if (authError || !signedIn.session) throw authError ?? new Error('QA sign-in returned no session');
  const { data: assignment, error: assignmentError } = await adminClient.from('student_room_assignments').select('id, student_id, status, is_sandbox').eq('id', assignmentId).eq('student_id', signedIn.user.id).maybeSingle();
  if (assignmentError) throw assignmentError;
  assert(assignment?.is_sandbox === true, 'Assignment is not marked synthetic/sandbox.');
  assert(['assigned', 'in_progress', 'active'].includes(assignment.status), `Assignment is not active: ${assignment?.status}`);

  const first = await invoke(signedIn.session.access_token);
  assert(first.status === 200 && first.body.message && first.body.requestId, `Initial consultant request failed: ${first.status}`);
  const retry = await invoke(signedIn.session.access_token);
  assert(retry.status === 200 && retry.body.idempotent === true, `Retry was not an idempotent replay: ${retry.status}`);
  assert(retry.body.message === first.body.message, 'Retry response differs from the original response.');

  // A fresh authenticated client proves the UI can reload durable state.
  const reloadClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: reloadAuth, error: reloadError } = await reloadClient.auth.signInWithPassword({ email: process.env.CONSULTANT_QA_EMAIL, password: process.env.CONSULTANT_QA_PASSWORD });
  if (reloadError || !reloadAuth.session) throw reloadError ?? new Error('Reload sign-in returned no session');
  const { data: persisted, error: persistedError } = await adminClient.from('consultant_requests').select('id, consult_order_id, response, status').eq('assignment_id', assignmentId).eq('client_request_id', requestId).single();
  if (persistedError) throw persistedError;
  orderId = persisted.consult_order_id;
  const [messages, orders] = await Promise.all([
    adminClient.from('consultant_chat_messages').select('id, role').eq('request_id', persisted.id),
    adminClient.from('medical_orders').select('id').eq('id', orderId).eq('assignment_id', assignmentId),
  ]);
  if (messages.error) throw messages.error;
  if (orders.error) throw orders.error;
  assert(persisted.status === 'answered' || persisted.status === 'assumes_care', `Unexpected persisted status: ${persisted.status}`);
  assert(persisted.response === first.body.message, 'Reloaded response differs from the rendered response.');
  assert(orders.data.length === 1, `Expected one consult order, found ${orders.data.length}`);
  assert(messages.data.filter(({ role }) => role === 'student').length === 1, 'Expected one student consult message.');
  assert(messages.data.filter(({ role }) => role === 'consultant').length === 1, 'Expected one consultant response message.');
  console.log('PASS: submit → retry → fresh authenticated reload produced one request, one consult order, one student message, and one consultant response.');
} finally {
  if (orderId) await adminClient.from('medical_orders').delete().eq('id', orderId).eq('assignment_id', assignmentId);
  await adminClient.from('consultant_chat_messages').delete().eq('request_id', requestId).eq('assignment_id', assignmentId);
  await adminClient.from('consultant_requests').delete().eq('client_request_id', requestId).eq('assignment_id', assignmentId);
  await authClient.auth.signOut();
}
