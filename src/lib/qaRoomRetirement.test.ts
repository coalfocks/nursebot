import { describe, expect, it } from 'vitest';
import {
  assertRestorableManifest,
  buildQaRoomRetirementManifest,
  buildRestoreSql,
  buildRetirementSql,
  isVisibleInActiveRoomList,
} from './qaRoomRetirement';

const rooms = [
  { id: 10, room_number: 'ED 28', school_id: 'school-a', school_slug: 'original-school', patient_id: 'patient-original', available_school_ids: ['school-a'], updated_at: '2026-10-22T00:00:00.000Z', is_active: true },
  { id: 11, room_number: 'QA-N-101', school_id: 'qa-north', school_slug: 'nurse-althea-qa-north-20261015', patient_id: null, available_school_ids: [], updated_at: null, is_active: true },
  { id: 12, room_number: 'QA-LIB-FEEDBACK-20261015', school_id: 'school-a', school_slug: 'original-school', patient_id: 'patient-qa', available_school_ids: ['school-a'], updated_at: '2026-10-22T00:00:00.000Z', is_active: true },
  { id: 13, room_number: 'Room 00', school_id: 'school-a', school_slug: 'original-school', patient_id: null, available_school_ids: [], updated_at: null, is_active: true },
  { id: 14, room_number: 'QA-FB-BEDSIDE-123', school_id: 'school-a', school_slug: 'original-school', patient_id: 'patient-bedside', available_school_ids: ['school-a'], updated_at: null, is_active: false },
];

describe('QA room retirement manifest', () => {
  it('selects only explicit synthetic QA rooms and excludes original cases and Room 00', () => {
    const manifest = buildQaRoomRetirementManifest(rooms, 13, '2026-10-22T00:00:00.000Z');
    expect(manifest.targets.map((room) => room.id)).toEqual([11, 12, 14]);
    expect(manifest.targets.find((room) => room.id === 14)?.previousIsActive).toBe(false);
  });

  it('emits only room inactivity updates, never dependent-row deletes', () => {
    const manifest = buildQaRoomRetirementManifest(rooms, 13);
    const retire = buildRetirementSql(manifest);
    const restore = buildRestoreSql(manifest);
    expect(retire).toContain('update public.rooms set is_active = false');
    expect(retire).not.toMatch(/delete/i);
    expect(retire).toMatch(/for update/);
    expect(retire).toMatch(/raise exception/);
    expect(retire).toMatch(/QA_ROOM_ACTIVE_LIST_NOT_EMPTY/);
    expect(retire).toMatch(/student_room_assignments/);
    expect(retire).toMatch(/QA_ROOM_ATTEMPT_ACCESS_CHANGED/);
    expect(restore).toContain('where id = 11');
    expect(restore).toContain('set is_active = false where id = 14');
  });

  it('rejects a manifest that includes Room 00 or has no targets', () => {
    const manifest = buildQaRoomRetirementManifest(rooms, 13);
    expect(() => assertRestorableManifest({ ...manifest, targets: [{ ...manifest.targets[0], id: 13 }] })).toThrow(/Room 00/);
    expect(() => assertRestorableManifest({ ...manifest, targets: [{ ...manifest.targets[0], ...rooms[0] }] })).toThrow(/outside/);
    expect(() => buildQaRoomRetirementManifest(rooms, null)).toThrow(/Room 00 identity/);
    expect(() => assertRestorableManifest({ ...manifest, targets: [] })).toThrow(/empty/);
  });

  it('removes retired rooms from the active management list without changing attempt visibility', () => {
    expect(isVisibleInActiveRoomList({ is_active: true })).toBe(true);
    expect(isVisibleInActiveRoomList({ is_active: false })).toBe(false);
  });
});
