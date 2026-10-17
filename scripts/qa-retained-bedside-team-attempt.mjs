import { randomUUID } from 'node:crypto';

const url = process.env.QA_SUPABASE_URL;
const key = process.env.QA_SERVICE_KEY;
const schoolId = process.env.QA_SCHOOL_ID;
const adminId = process.env.QA_ADMIN_ID;
if (!url || !key || !schoolId || !adminId) throw new Error('QA_SUPABASE_URL, QA_SERVICE_KEY, QA_SCHOOL_ID, and QA_ADMIN_ID are required');
if (process.env.QA_CONFIRM !== 'RETAIN_SYNTHETIC_BEDSIDE_TEAM_20261015') throw new Error('Refusing retained synthetic writes without explicit confirmation');

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const created = { authUserId: null, profileId: null, specialtyId: null, patientId: null, roomId: null, assignmentId: null, actionIds: [], messageIds: [], vitalId: null, orderId: null, noteId: null };
const roomNumber = `QA-FB-BEDSIDE-${suffix}`;
const learnerEmail = `synthetic-bedside-team-${suffix}@example.invalid`;
const learnerPassword = `QA_${randomUUID()}_Only!`;

async function api(path, options = {}) {
  const response = await fetch(`${url}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const bodyText = await response.text(); let body; try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}
const post = async (table, value) => (await api(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(value) }))[0];
const enc = encodeURIComponent;

try {
  const auth = await api('/auth/v1/admin/users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ email: learnerEmail, password: learnerPassword, email_confirm: true, user_metadata: { qa_fixture: true, synthetic_feedback_qa: true, full_name: `Synthetic Bedside Team ${suffix}` } }) });
  created.authUserId = auth.id;
  created.profileId = (await post('profiles', { id: auth.id, email: learnerEmail, full_name: `Synthetic Bedside Team ${suffix}`, role: 'student', is_admin: false, school_id: schoolId, learner_program: 'medical', specialization_interest: 'Synthetic feedback QA', study_year: 1, sms_consent: false })).id;
  created.specialtyId = (await post('specialties', { name: `Synthetic Bedside Team ${suffix}`, description: 'Retained bedside/team feedback regression fixture.', school_id: schoolId })).id;
  created.patientId = (await post('patients', { school_id: schoolId, mrn: `SYN-BEDSIDE-${suffix}`, first_name: 'Morgan', last_name: 'Reed', date_of_birth: '1986-09-17', gender: 'female', service: 'Synthetic QA', admission_date: new Date().toISOString().slice(0, 10), code_status: 'Full code' })).id;
  const evaluation = { version: 'case-key-v2-bedside-team-2026-10-15', goals: ['Recognize acute instability from bedside findings.', 'Escalate to the senior clinician through an observable team channel.', 'Initiate targeted monitoring and reassess.'], acuityUrgencyTrigger: 'Hypotension with tachycardia and cool extremities requires immediate bedside assessment.', expectedEndpoint: 'Stabilization plan communicated to the senior clinician with reassessment.', timeSensitiveActions: ['Bedside assessment', 'Immediate team escalation', 'Continuous monitoring and reassessment'], must: ['document focused bedside findings', 'escalate to senior clinician', 'order urgent monitoring'], should: ['state a closed-loop reassessment plan'], could: ['ask the patient a focused symptom question'], shouldNot: ['delay assessment for nurse chat'], mustNot: ['ignore persistent hypotension'], acceptableAlternativePaths: ['Escalation in person or through a structured team action is equivalent to nurse chat when linked to the learner action.'], decisionCriticalQuestionsFindings: ['blood pressure trend', 'perfusion findings', 'mental status'], noteElements: ['findings', 'escalation recipient', 'reassessment plan'], observedChannels: ['bedside', 'team', 'chart', 'orders_results'], safetyRationale: 'Delay or failure to escalate persistent hypotension is unsafe.' };
  const room = await post('rooms', { school_id: schoolId, specialty_id: created.specialtyId, room_number: roomNumber, role: 'Synthetic retained feedback QA only', learner_program: 'medical', bedside_requirement: 'yes', bedside_hint: 'Go directly to the bedside and document findings before team escalation.', objective: 'Recognize instability, assess at bedside, escalate through the team, monitor, and reassess.', case_goals: evaluation.goals.join('\n'), context: 'Fictional retained synthetic feedback regression case. Not for clinical use.', nurse_context: 'Synthetic nurse page: patient is suddenly dizzy with low blood pressure and tachycardia.', patient_conversation_enabled: true, patient_conversation_prompt: 'Patient answers only focused questions from the authored history.', patient_participation_reason: 'Fictional synthetic participant.', completion_token: `<synthetic-retained-${suffix}-complete>`, difficulty_level: 'advanced', expected_diagnosis: 'Synthetic acute instability', expected_treatment: ['Bedside assessment', 'Team escalation', 'Monitoring and reassessment'], emr_context: JSON.stringify({ evaluation, admission: { hAndP: 'Synthetic H&P: acute dizziness and poor perfusion.', vitals: 'Admission baseline stable.', labs: 'Admission baseline normal.' } }), example_progress_note: 'Document findings, escalation recipient, monitoring, and reassessment.', created_by: adminId, is_active: true });
  created.roomId = room.id;
  await api(`/rest/v1/patients?id=eq.${enc(created.patientId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ room_id: created.roomId }) });
  await api(`/rest/v1/rooms?id=eq.${enc(created.roomId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ patient_id: created.patientId }) });
  created.assignmentId = (await post('student_room_assignments', { school_id: schoolId, student_id: created.profileId, room_id: created.roomId, assigned_by: adminId, learner_program: 'medical', status: 'completed', feedback_status: 'pending', completion_token_matched: true, completed_at: new Date().toISOString(), student_progress_note: 'I assessed the patient at bedside, found cool extremities and delayed capillary refill, escalated directly to the senior clinician, initiated monitoring, and documented reassessment.', case_difficulty: 'advanced' })).id;
  const start = new Date(Date.now() - 7 * 60 * 1000); const at = (seconds) => new Date(start.getTime() + seconds * 1000).toISOString();
  const messages = await api('/rest/v1/chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ assignment_id: created.assignmentId, school_id: schoolId, role: 'assistant', content: 'Nurse page: Patient is suddenly dizzy; BP 82/48, HR 126, appears pale.', created_at: at(0) }, { assignment_id: created.assignmentId, school_id: schoolId, role: 'assistant', content: '<completed>', created_at: at(210) }]) });
  created.messageIds = messages.map((row) => row.id);
  const actions = await api('/rest/v1/learner_action_events', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([
    { assignment_id: created.assignmentId, room_id: created.roomId, action_type: 'bedside_finding', channel: 'bedside', content: 'At bedside: cool extremities, delayed capillary refill, pale appearance, and ongoing dizziness.', occurred_at: at(25), created_by: created.profileId },
    { assignment_id: created.assignmentId, room_id: created.roomId, action_type: 'team_escalation', channel: 'team', content: 'Escalated persistent hypotension and perfusion findings directly to the senior clinician and requested immediate review.', occurred_at: at(40), created_by: created.profileId },
  ]) });
  created.actionIds = actions.map((row) => row.id);
  created.vitalId = (await post('vital_signs', { patient_id: created.patientId, school_id: schoolId, room_id: created.roomId, assignment_id: created.assignmentId, override_scope: 'assignment', timestamp: at(30), blood_pressure_systolic: 82, blood_pressure_diastolic: 48, heart_rate: 126, respiratory_rate: 26, oxygen_saturation: 93, temperature: 37.1 })).id;
  created.orderId = (await post('medical_orders', { patient_id: created.patientId, school_id: schoolId, room_id: created.roomId, assignment_id: created.assignmentId, override_scope: 'assignment', category: 'Monitoring', order_name: 'Continuous cardiac and pulse oximetry monitoring', priority: 'STAT', status: 'Completed', ordered_by: 'Synthetic learner', order_time: at(55), instructions: 'Repeat vital signs and reassess perfusion promptly.' })).id;
  created.noteId = (await post('clinical_notes', { patient_id: created.patientId, school_id: schoolId, room_id: created.roomId, assignment_id: created.assignmentId, override_scope: 'assignment', note_type: 'progress', title: 'Synthetic bedside/team progress note', content: 'Focused bedside findings, direct senior-clinician escalation, monitoring, and reassessment plan documented.', author: 'Synthetic learner', timestamp: at(160), signed: true })).id;
  const feedback = await fetch(`${url}/functions/v1/generate-feedback`, { method: 'POST', headers, body: JSON.stringify({ assignmentId: created.assignmentId }) });
  const feedbackText = await feedback.text(); let feedbackBody; try { feedbackBody = JSON.parse(feedbackText); } catch { feedbackBody = feedbackText; }
  if (!feedback.ok) throw new Error(`generate-feedback failed (${feedback.status}): ${JSON.stringify(feedbackBody)}`);
  const assignment = (await api(`/rest/v1/student_room_assignments?select=id,student_id,room_id,status,feedback_status,communication_score,mdm_score,communication_breakdown,mdm_breakdown,source_event_ids,scoring_start_at,technical_incomplete,rubric_version,case_key_version,assessment_version,feedback_debrief&id=eq.${enc(created.assignmentId)}`))[0];
  const roomReadback = (await api(`/rest/v1/rooms?select=id,room_number,patient_id,objective,case_goals,emr_context&id=eq.${enc(created.roomId)}`))[0];
  const actionsReadback = await api(`/rest/v1/learner_action_events?select=id,action_type,channel,content,occurred_at&assignment_id=eq.${enc(created.assignmentId)}&order=occurred_at.asc`);
  console.log(JSON.stringify({ ok: true, retained: true, learnerEmail, learnerPassword, room: roomReadback, assignment, learnerActions: actionsReadback, ids: created, feedbackResponse: feedbackBody }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
