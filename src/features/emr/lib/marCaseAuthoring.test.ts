import { describe, expect, it } from 'vitest';
import { authoredEventsToSave, buildCaseMarPreview, defaultCaseMedicationDraft, MAR_HISTORY_OPTIONS } from './marCaseAuthoring';
import type { MedicalOrder } from './types';

const order = (overrides: Partial<MedicalOrder> = {}): MedicalOrder => ({
  id: 'med-1', patientId: 'patient-1', roomId: 7, category: 'Medication', orderName: 'Example', dose: '10 mg', route: 'PO', frequency: 'q4h', priority: 'Routine', status: 'Active', orderedBy: 'Author', orderTime: '2026-10-20T00:00:00Z', ...overrides,
});

describe('Case Builder MAR authoring', () => {
  it('exposes exactly the supported history choices', () => expect(MAR_HISTORY_OPTIONS).toEqual([12, 24, 36, 48, 60, 72]));
  it('previews q4h without a zero-hour event and copies order metadata', () => {
    const result = buildCaseMarPreview([order()], { 'med-1': { ...defaultCaseMedicationDraft(order()), startPriorHours: '12' } }, 12);
    expect(result.errors).toEqual([]);
    expect(result.events.map((event) => event.relativeOffsetHours)).toEqual([12, 8, 4]);
    expect(result.events[0]).toMatchObject({ orderedDose: '10 mg', route: 'PO', frequency: 'q4h', status: 'Given' });
  });
  it('requires explicit PRN timing when the author says it was given', () => {
    const medication = order({ id: 'prn', orderName: 'PRN', frequency: 'PRN', instructions: 'PRN' });
    const result = buildCaseMarPreview([medication], { prn: { ...defaultCaseMedicationDraft(medication), prnGiven: true } }, 12);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain('MAR_EXPLICIT_TIMES_REQUIRED');
  });
  it('rejects a PRN preview when the author supplies no Given timing', () => {
    const medication = order({ id: 'prn-no-time', orderName: 'PRN', frequency: 'PRN', instructions: 'PRN' });
    const result = buildCaseMarPreview([medication], { 'prn-no-time': defaultCaseMedicationDraft(medication) }, 12);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain('MAR_PRN_TIMING_REQUIRED');
  });
  it('creates infusion lifecycle events and never a bolus', () => {
    const medication = order({ id: 'iv', orderName: 'IV fluid', frequency: 'continuous' });
    const result = buildCaseMarPreview([medication], { iv: { ...defaultCaseMedicationDraft(medication), category: 'infusion', infusionStartPriorHours: '12', infusionChangePriorHours: '6', infusionStopPriorHours: '2' } }, 12);
    expect(result.events.map((event) => event.status)).toEqual(['Started', 'Rate changed', 'Stopped']);
    expect(result.events.every((event) => event.category === 'infusion')).toBe(true);
  });
  it('does not resend an existing authored occurrence, preserving manual edits', () => {
    const result = buildCaseMarPreview([order()], { 'med-1': { ...defaultCaseMedicationDraft(order()), startPriorHours: '12' } }, 12);
    const existing = [{ ...result.events[0], id: 'saved', status: 'Held' as const, patientId: 'patient-1', roomId: 7, recordVersion: 2 }];
    expect(authoredEventsToSave(result.events, existing, 'patient-1', 7, 'baseline-v1', 'Author')).toHaveLength(2);
  });
});
