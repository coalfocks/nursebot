const base = 'https://lvpbwtfvairspufrashl.supabase.co';
const key = process.env.QA_SERVICE_KEY;
const superadmin = process.env.QA_SUPERADMIN_ID;
if (!key || !superadmin) throw new Error('QA_SERVICE_KEY and QA_SUPERADMIN_ID are required');
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

const one = async (path) => (await api(path))[0] ?? null;
const enc = encodeURIComponent;

async function ensureSchool(name, slug) {
  return await one(`/rest/v1/schools?select=id,name,slug&slug=eq.${enc(slug)}`) ?? (await api('/rest/v1/schools', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name, slug, timezone: 'UTC' }) }))[0];
}

async function ensureSpecialty(schoolId, name) {
  return await one(`/rest/v1/specialties?select=id,name,school_id&school_id=eq.${schoolId}&name=eq.${enc(name)}`) ?? (await api('/rest/v1/specialties', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name, description: 'Synthetic analytics QA specialty. Not a clinical case.', school_id: schoolId }) }))[0];
}

async function ensureLearner(schoolId, region, index) {
  const email = `qa-analytics-${region}-learner-${index}-20261015@example.invalid`;
  const existing = await one(`/rest/v1/profiles?select=id,email,school_id&email=eq.${enc(email)}`);
  if (existing) return existing;
  const authUser = await api('/auth/v1/admin/users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ email, password: `Q4_${crypto.randomUUID()}_qaOnly!`, email_confirm: true, user_metadata: { qa_fixture: true, full_name: `QA Learner ${region} ${index}` } }) });
  return (await api('/rest/v1/profiles', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: authUser.id, email, full_name: `QA Learner ${region} ${index}`, study_year: 1, specialization_interest: 'Synthetic QA', is_admin: false, role: 'student', school_id: schoolId, sms_consent: false }) }))[0];
}

async function ensureRoom(schoolId, specialtyId, region, index) {
  const roomNumber = `QA-${region[0]}-${101 + index}`;
  const existing = await one(`/rest/v1/rooms?select=id,room_number,school_id&school_id=eq.${schoolId}&room_number=eq.${enc(roomNumber)}`);
  if (existing) return existing;
  return (await api('/rest/v1/rooms', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ school_id: schoolId, specialty_id: specialtyId, room_number: roomNumber, role: 'QA synthetic analytics case', bedside_requirement: 'no', completion_token: `<qa-${roomNumber.toLowerCase()}-complete>`, context: 'Fictional analytics fixture. No clinical content.', nurse_context: 'Synthetic QA workflow context.', patient_conversation_enabled: false, patient_speaker_type: 'patient', is_active: true, difficulty_level: index % 2 ? 'intermediate' : 'beginner', expected_diagnosis: 'Synthetic QA outcome', expected_treatment: ['Synthetic QA action'], created_by: superadmin }) }))[0];
}

async function ensureAssignment(schoolId, learnerId, roomId, daysAgo, status, feedbackStatus, grade, communication, mdm) {
  if (await one(`/rest/v1/student_room_assignments?select=id&school_id=eq.${schoolId}&student_id=eq.${learnerId}&room_id=eq.${roomId}`)) return;
  const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const completedAt = status === 'completed' ? new Date(new Date(createdAt).getTime() + 28 * 60000).toISOString() : null;
  await api('/rest/v1/student_room_assignments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ school_id: schoolId, student_id: learnerId, room_id: roomId, assigned_by: superadmin, status, feedback_status: feedbackStatus, grade, communication_score: communication, mdm_score: mdm, communication_breakdown: { history: communication == null ? null : Math.max(1, Math.round(communication / 2)), handoff: communication == null ? null : Math.min(5, Math.round(communication / 2)) }, mdm_breakdown: { prioritization: mdm == null ? null : Math.max(1, Math.round(mdm / 2)), orders: mdm == null ? null : Math.min(5, Math.round(mdm / 2)) }, nurse_feedback: feedbackStatus === 'completed' ? { overall_score: grade, source: 'synthetic QA fixture', rubric_version: 'qa-analytics-1' } : null, completion_token_matched: status === 'completed', created_at: createdAt, completed_at: completedAt, updated_at: completedAt ?? createdAt, case_difficulty: status === 'completed' ? 'intermediate' : 'easy' }) });
}

async function cleanup() {
  if (process.env.QA_CLEANUP_CONFIRM !== 'DELETE_NURSE_ALTHEA_ANALYTICS_QA_20261015') throw new Error('Refusing cleanup without QA_CLEANUP_CONFIRM=DELETE_NURSE_ALTHEA_ANALYTICS_QA_20261015');
  const slugs = ['nurse-althea-qa-north-20261015', 'nurse-althea-qa-south-20261015'];
  const removed = [];
  for (const slug of slugs) {
    const school = await one(`/rest/v1/schools?select=id,name,slug&slug=eq.${slug}`);
    if (!school) continue;
    const profiles = await api(`/rest/v1/profiles?select=id,email&school_id=eq.${school.id}&email=like.qa-analytics-*`);
    await api(`/rest/v1/student_room_assignments?school_id=eq.${school.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await api(`/rest/v1/rooms?school_id=eq.${school.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await api(`/rest/v1/specialties?school_id=eq.${school.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await api(`/rest/v1/profiles?school_id=eq.${school.id}&email=like.qa-analytics-*`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    for (const profile of profiles) await api(`/auth/v1/admin/users/${profile.id}`, { method: 'DELETE' });
    await api(`/rest/v1/schools?id=eq.${school.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    removed.push({ id: school.id, slug });
  }
  console.log(JSON.stringify({ removed }));
}

async function seed() {
  const definitions = [['Nurse Althea QA North (Synthetic)', 'nurse-althea-qa-north-20261015', 'North', 3], ['Nurse Althea QA South (Synthetic)', 'nurse-althea-qa-south-20261015', 'South', 2]];
  const result = [];
  for (const [name, slug, region, learnerTotal] of definitions) {
    const school = await ensureSchool(name, slug);
    const specialties = [await ensureSpecialty(school.id, 'QA Emergency Workflow'), await ensureSpecialty(school.id, 'QA Pediatrics Workflow')];
    const learners = await Promise.all(Array.from({ length: learnerTotal }, (_, index) => ensureLearner(school.id, region.toLowerCase(), index + 1)));
    const rooms = await Promise.all(Array.from({ length: 4 }, (_, index) => ensureRoom(school.id, specialties[index % 2].id, region, index)));
    for (let learnerIndex = 0; learnerIndex < learners.length; learnerIndex += 1) for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
      const status = learnerIndex === 0 && roomIndex === 3 ? 'assigned' : learnerIndex === 1 && roomIndex === 2 ? 'in_progress' : 'completed';
      const feedback = status !== 'completed' ? 'pending' : learnerIndex === 0 && roomIndex === 1 ? 'pending' : learnerIndex === 0 && roomIndex === 2 ? 'failed' : 'completed';
      await ensureAssignment(school.id, learners[learnerIndex].id, rooms[roomIndex].id, 2 + learnerIndex * 7 + roomIndex, status, feedback, status === 'completed' ? 68 + learnerIndex * 8 + roomIndex : null, status === 'completed' ? 3 + roomIndex % 3 : null, status === 'completed' ? 2 + (learnerIndex + roomIndex) % 4 : null);
    }
    result.push({ id: school.id, name, slug, learners: learners.length, rooms: rooms.length, assignments: learners.length * rooms.length });
  }
  console.log(JSON.stringify({ schools: result, totalAssignments: result.reduce((sum, item) => sum + item.assignments, 0) }));
}

if (process.argv.includes('--cleanup')) await cleanup();
else await seed();
