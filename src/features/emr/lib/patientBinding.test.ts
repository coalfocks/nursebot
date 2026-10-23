import { describe, expect, it } from 'vitest';
import { resolveCanonicalRoomPatient } from './patientBinding';

describe('canonical room patient binding', () => {
  const patient = { id: 'shared-patient' };

  it('uses the room binding even when the reusable patient room id points elsewhere', () => {
    expect(resolveCanonicalRoomPatient({ id: 84, patient_id: patient.id, patient }, 84)).toEqual({ status: 'resolved', patient, roomId: 84 });
  });

  it('fails closed when the embedded patient is missing or differs from the binding', () => {
    expect(resolveCanonicalRoomPatient({ id: 84, patient_id: patient.id, patient: null }, 84).status).toBe('mismatch');
    expect(resolveCanonicalRoomPatient({ id: 84, patient_id: patient.id, patient: { id: 'duplicate-patient' } }, 84).status).toBe('mismatch');
    expect(resolveCanonicalRoomPatient({ id: 37, patient_id: patient.id, patient }, 84).status).toBe('mismatch');
  });

  it('allows legacy fallback only when the room has no canonical patient binding', () => {
    expect(resolveCanonicalRoomPatient({ id: 84, patient_id: null, patient }, 84).status).toBe('unbound');
  });
});
