import { buildNurseSystemPrompt, NURSE_INFORMATION_POLICY } from './nurse-context.ts';
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
Deno.test('owner wording is byte-exact', async () => {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(NURSE_INFORMATION_POLICY)))).map(n => n.toString(16).padStart(2, '0')).join('');
  assert(hash === '55fb3cb930bfa56019a1c1ef095fe8df1c2c98f3ed54f21504697ac6d3436745', 'policy changed');
});
Deno.test('empty assignment vitals preserve authored incident temperature, oxygen and timing', () => {
  const context = 'Opening: please assess. Incident 19:00: T 38.2°C, SpO2 92% on 2 L nasal cannula. Baseline 08:00: T 37°C. Admission panel normal.';
  const prompt = buildNurseSystemPrompt({ nurse_context: context }, '', 'assignment scenario_baseline snapshot');
  assert(prompt.includes(context), 'authored facts lost');
  assert(prompt.includes('authored context remains available'), 'empty measurement fallback suppresses facts');
  assert(!prompt.includes('use only these for quantitative'), 'contradictory authority remains');
  assert(prompt.includes('assignment scenario_baseline snapshot'), 'provenance lost');
});
Deno.test('later scoped measurement remains separate from authored sets', () => {
  const prompt = buildNurseSystemPrompt({ nurse_context: 'Incident 19:00 T 38°C' }, 'Source: vital_signs row synthetic, assignment synthetic; recorded at 19:10; Temperature 101 °F');
  assert(prompt.includes('Incident 19:00 T 38°C') && prompt.includes('recorded at 19:10'), 'sets conflated');
  assert(prompt.includes('EMR for those new results') && prompt.includes('MAR and do not invent'), 'new result boundaries lost');
});
Deno.test('handler pins patient and excludes future and foreign attempt measurements', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  for (const fragment of ['const patientId = pinnedRoom?.patient_id', ".eq('patient_id', patientId)", ".eq('assignment_id', resolvedAssignmentId)", ".lte('timestamp', new Date().toISOString())", 'temperature', 'latest.timestamp']) assert(source.includes(fragment), `missing ${fragment}`);
});
