export type QaRoomReadback = {
  id: number;
  room_number: string | null;
  school_id: string | null;
  school_slug?: string | null;
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
  if (manifest.targets.length === 0) throw new Error('Refusing an empty retirement/restore manifest');
  const ids = new Set<number>();
  for (const target of manifest.targets) {
    if (ids.has(target.id)) throw new Error(`Duplicate room id in manifest: ${target.id}`);
    ids.add(target.id);
    if (target.id === manifest.room00Id) throw new Error('Manifest contains Room 00');
    if (target.previousIsActive !== true && target.previousIsActive !== false) {
      throw new Error(`Invalid previous is_active for room ${target.id}`);
    }
  }
}

export function buildRetirementSql(manifest: QaRoomRetirementManifest): string {
  assertRestorableManifest(manifest);
  const ids = manifest.targets.map((room) => room.id).join(', ');
  return [
    'begin;',
    'set local lock_timeout = \'5s\';',
    `-- Preflight: exact reviewed target IDs only; Room 00 (${manifest.room00Id ?? 'not configured'}) is excluded.`,
    `select id, room_number, is_active from public.rooms where id in (${ids}) order by id;`,
    `update public.rooms set is_active = false where id in (${ids}) returning id, room_number, is_active;`,
    `-- Verify patient, assignment, packet, audit, snapshot, note, order, action, and pin counts before/after.`,
    'commit;',
  ].join('\n');
}

export function buildRestoreSql(manifest: QaRoomRetirementManifest): string {
  assertRestorableManifest(manifest);
  const statements = manifest.targets.map((room) =>
    `update public.rooms set is_active = ${room.previousIsActive ? 'true' : 'false'} where id = ${room.id};`,
  );
  return [
    'begin;',
    'set local lock_timeout = \'5s\';',
    ...statements,
    '-- Verify every dependent-row digest is unchanged, then commit; rollback on any mismatch.',
    'commit;',
  ].join('\n');
}
