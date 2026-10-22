export type QaRoomReadback = {
  id: number;
  room_number: string | null;
  school_id: string;
  school_slug: string;
  patient_id: string | null;
  available_school_ids: string[] | null;
  updated_at: string | null;
  is_active: boolean;
};

export type QaRoomRetirementManifest = {
  format: 'qa-room-retirement-v1';
  generatedAt: string;
  room00Id: number | null;
  targets: Array<QaRoomReadback & { previousIsActive: boolean }>;
};

const ANALYTICS_SCHOOLS = new Set([
  'nurse-althea-qa-north-20261015',
  'nurse-althea-qa-south-20261015',
]);

const EXPLICIT_ROOM_PREFIXES = [
  'QA-MAR-',
  'QA-FB-BEDSIDE-',
];

const EXPLICIT_ROOM_NUMBERS = new Set([
  'QA-LIB-FEEDBACK-20261015',
]);

export function isAddedQaRoom(room: QaRoomReadback, room00Id: number | null): boolean {
  if (room00Id !== null && room.id === room00Id) return false;
  const roomNumber = room.room_number ?? '';
  if (EXPLICIT_ROOM_NUMBERS.has(roomNumber)) return true;
  if (EXPLICIT_ROOM_PREFIXES.some((prefix) => roomNumber.startsWith(prefix))) return true;
  return room.school_slug !== null && room.school_slug !== undefined && ANALYTICS_SCHOOLS.has(room.school_slug)
    && roomNumber.startsWith('QA-');
}

export function buildQaRoomRetirementManifest(
  rooms: QaRoomReadback[],
  room00Id: number | null,
  generatedAt = new Date().toISOString(),
): QaRoomRetirementManifest {
  if (!Number.isInteger(room00Id) || room00Id <= 0) throw new Error('Room 00 identity is required before targeting any room');
  const targets = rooms
    .filter((room) => isAddedQaRoom(room, room00Id))
    .map((room) => ({ ...room, previousIsActive: room.is_active }))
    .sort((a, b) => a.id - b.id);

  if (targets.some((room) => room.id === room00Id)) {
    throw new Error('Room 00 cannot be included in a retirement manifest');
  }

  return { format: 'qa-room-retirement-v1', generatedAt, room00Id, targets };
}

export function assertRestorableManifest(manifest: QaRoomRetirementManifest): void {
  if (manifest.format !== 'qa-room-retirement-v1') throw new Error('Unsupported retirement manifest format');
  if (!Number.isInteger(manifest.room00Id) || manifest.room00Id <= 0) throw new Error('Manifest must contain a known Room 00 id');
  if (!Number.isFinite(Date.parse(manifest.generatedAt))) throw new Error('Manifest generatedAt must be an ISO timestamp');
  if (!Array.isArray(manifest.targets)) throw new Error('Manifest targets must be an array');
  if (manifest.targets.length === 0) throw new Error('Refusing an empty retirement/restore manifest');
  const ids = new Set<number>();
  for (const target of manifest.targets) {
    if (!Number.isInteger(target.id) || target.id <= 0) throw new Error('Room ids must be positive integers');
    if (ids.has(target.id)) throw new Error(`Duplicate room id in manifest: ${target.id}`);
    ids.add(target.id);
    if (target.id === manifest.room00Id) throw new Error('Manifest contains Room 00');
    if (!isAddedQaRoom(target, manifest.room00Id)) throw new Error(`Room ${target.id} is outside the explicit QA retirement scope`);
    if (typeof target.room_number !== 'string' || !target.room_number.trim()) throw new Error(`Room ${target.id} has no typed room number`);
    if (typeof target.school_id !== 'string' || !target.school_id.trim()) throw new Error(`Room ${target.id} has no typed school id`);
    if (typeof target.school_slug !== 'string' || !target.school_slug.trim()) throw new Error(`Room ${target.id} has no typed school slug`);
    if (target.patient_id !== null && typeof target.patient_id !== 'string') throw new Error(`Room ${target.id} has an invalid patient id`);
    if (target.available_school_ids !== null && (!Array.isArray(target.available_school_ids) || target.available_school_ids.some((id) => typeof id !== 'string'))) {
      throw new Error(`Room ${target.id} has invalid available school ids`);
    }
    if (target.updated_at !== null && (typeof target.updated_at !== 'string' || !Number.isFinite(Date.parse(target.updated_at)))) throw new Error(`Room ${target.id} has an invalid updated_at`);
    if (typeof target.is_active !== 'boolean') throw new Error(`Room ${target.id} has an invalid is_active`);
    if (target.previousIsActive !== true && target.previousIsActive !== false) {
      throw new Error(`Invalid previous is_active for room ${target.id}`);
    }
  }
}

export const isVisibleInActiveRoomList = (room: Pick<QaRoomReadback, 'is_active'>): boolean => room.is_active;

const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const sqlJson = (value: unknown): string => `${sqlText(JSON.stringify(value))}::jsonb`;

const dependencySnapshot = (id: number): string => `jsonb_build_object(
  'student_room_assignments', (select count(*) from public.student_room_assignments where room_id = ${id}),
  'chat_messages', (select count(*) from public.chat_messages m join public.student_room_assignments a on a.id = m.assignment_id where a.room_id = ${id}),
  'clinical_notes', (select count(*) from public.clinical_notes where room_id = ${id}),
  'medical_orders', (select count(*) from public.medical_orders where room_id = ${id}),
  'learner_action_events', (select count(*) from public.learner_action_events where room_id = ${id}),
  'vital_signs', (select count(*) from public.vital_signs where room_id = ${id}),
  'manual_mar_packets', (select count(*) from public.manual_mar_packets where room_id = ${id}),
  'manual_mar_packet_audit', (select count(*) from public.manual_mar_packet_audit where room_id = ${id}),
  'manual_mar_assignment_snapshots', (select count(*) from public.manual_mar_assignment_snapshots where room_id = ${id})
)`;

const metadataSnapshot = (room: QaRoomReadback, active = room.is_active): string => sqlJson({
  id: room.id,
  room_number: room.room_number,
  school_id: room.school_id,
  school_slug: room.school_slug,
  patient_id: room.patient_id,
  available_school_ids: room.available_school_ids,
  updated_at: room.updated_at,
  is_active: active,
});

const liveMetadata = (id: number): string => `(select jsonb_build_object('id', r.id, 'room_number', r.room_number, 'school_id', r.school_id, 'school_slug', s.slug, 'patient_id', r.patient_id, 'available_school_ids', r.available_school_ids, 'updated_at', r.updated_at, 'is_active', r.is_active) from public.rooms r left join public.schools s on s.id = r.school_id where r.id = ${id})`;

const assertionBlock = (manifest: QaRoomRetirementManifest, expectedActive: (room: QaRoomReadback) => boolean): string => manifest.targets.map((room) => [
  `if (not exists (select 1 from public.rooms where id = ${room.id})) then raise exception 'QA_ROOM_MISSING:%', ${room.id}; end if;`,
  `if ((${dependencySnapshot(room.id)}) <> (select dependencies from qa_room_retirement_baseline where id = ${room.id})) then raise exception 'QA_ROOM_DEPENDENCY_CHANGED:%', ${room.id}; end if;`,
  `if (${liveMetadata(room.id)} <> (select metadata from qa_room_retirement_expected where id = ${room.id})) then raise exception 'QA_ROOM_METADATA_CHANGED:%', ${room.id}; end if;`,
  `if ((select count(*) from public.student_room_assignments a join public.rooms r on r.id = a.room_id where a.room_id = ${room.id}) <> ((select dependencies from qa_room_retirement_baseline where id = ${room.id})->>'student_room_assignments')::bigint) then raise exception 'QA_ROOM_ATTEMPT_ACCESS_CHANGED:%', ${room.id}; end if;`,
  `if ((select metadata->>'is_active' from qa_room_retirement_expected where id = ${room.id}) <> ${sqlText(String(expectedActive(room)))}) then raise exception 'QA_ROOM_ACTIVE_STATE_CHANGED:%', ${room.id}; end if;`,
].join('\n')).join('\n');

export function buildRetirementSql(manifest: QaRoomRetirementManifest): string {
  assertRestorableManifest(manifest);
  const ids = manifest.targets.map((room) => room.id).join(', ');
  return [
    'begin;',
    'set local lock_timeout = \'5s\';',
    'set local statement_timeout = \'30s\';',
    `create temp table qa_room_retirement_expected(id bigint primary key, metadata jsonb not null);`,
    `create temp table qa_room_retirement_baseline(id bigint primary key, dependencies jsonb not null);`,
    `insert into qa_room_retirement_expected(id, metadata) values ${manifest.targets.map((room) => `(${room.id}, ${metadataSnapshot(room)})`).join(', ')};`,
    `insert into qa_room_retirement_baseline(id, dependencies) values ${manifest.targets.map((room) => `(${room.id}, ${dependencySnapshot(room.id)})`).join(', ')};`,
    `do $$ begin if (select count(*) from public.rooms where id in (${ids})) <> ${manifest.targets.length} then raise exception 'QA_ROOM_TARGET_COUNT_CHANGED'; end if; end $$;`,
    ...manifest.targets.map((room) => `do $$ begin if (${liveMetadata(room.id)} <> (select metadata from qa_room_retirement_expected where id = ${room.id})) then raise exception 'QA_ROOM_PREFLIGHT_METADATA_CHANGED:%', ${room.id}; end if; end $$;`),
    `select id from public.rooms where id in (${ids}) order by id for update;`,
    `update public.rooms set is_active = false where id in (${ids}) and is_active is distinct from false returning id;`,
    `truncate qa_room_retirement_expected; insert into qa_room_retirement_expected(id, metadata) values ${manifest.targets.map((room) => `(${room.id}, ${metadataSnapshot(room, false)})`).join(', ')};`,
    `do $$ begin ${assertionBlock(manifest, () => false)} if (select count(*) from public.rooms where id in (${ids}) and is_active) <> 0 then raise exception 'QA_ROOM_ACTIVE_LIST_NOT_EMPTY'; end if; end $$;`,
    'commit;',
  ].join('\n');
}

export function buildRestoreSql(manifest: QaRoomRetirementManifest): string {
  assertRestorableManifest(manifest);
  const ids = manifest.targets.map((room) => room.id).join(', ');
  return [
    'begin;',
    'set local lock_timeout = \'5s\';',
    'set local statement_timeout = \'30s\';',
    'create temp table qa_room_retirement_expected(id bigint primary key, metadata jsonb not null);',
    'create temp table qa_room_retirement_baseline(id bigint primary key, dependencies jsonb not null);',
    `insert into qa_room_retirement_expected(id, metadata) values ${manifest.targets.map((room) => `(${room.id}, ${metadataSnapshot(room, false)})`).join(', ')};`,
    `insert into qa_room_retirement_baseline(id, dependencies) values ${manifest.targets.map((room) => `(${room.id}, ${dependencySnapshot(room.id)})`).join(', ')};`,
    `do $$ begin if (select count(*) from public.rooms where id in (${ids})) <> ${manifest.targets.length} then raise exception 'QA_ROOM_TARGET_COUNT_CHANGED'; end if; end $$;`,
    ...manifest.targets.map((room) => `do $$ begin if (${liveMetadata(room.id)} <> (select metadata from qa_room_retirement_expected where id = ${room.id})) then raise exception 'QA_ROOM_RESTORE_PRECONDITION_CHANGED:%', ${room.id}; end if; end $$;`),
    `select id from public.rooms where id in (${ids}) order by id for update;`,
    ...manifest.targets.map((room) => `update public.rooms set is_active = ${room.previousIsActive ? 'true' : 'false'} where id = ${room.id} and room_number = ${sqlText(room.room_number ?? '')} and school_id = ${sqlText(room.school_id)}::uuid and is_active = false;`),
    `truncate qa_room_retirement_expected; insert into qa_room_retirement_expected(id, metadata) values ${manifest.targets.map((room) => `(${room.id}, ${metadataSnapshot(room, room.previousIsActive)})`).join(', ')};`,
    `do $$ begin ${assertionBlock(manifest, (room) => room.previousIsActive)} end $$;`,
    'commit;',
  ].join('\n');
}
