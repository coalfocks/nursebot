import { describe, expect, it } from 'vitest';
import { authoredEventsToSave, buildCaseMarPreview, defaultCaseMedicationDraft, isRoomScopedAuthoredEvent, isRoomScopedAuthoredOrder, MAR_HISTORY_OPTIONS, mergePreviewWithExisting, orderDefinitionFingerprint, updatePreviewEvent } from './marCaseAuthoring';
import type { MedicalOrder } from './types';

const order = (overrides: Partial<MedicalOrder> = {}): MedicalOrder => ({
  id: 'med-1', patientId: 'patient-1', roomId: 7, category: 'Medication', orderName: 'Example', dose: '10 mg', route: 'PO', frequency: 'q4h', priority: 'Routine', status: 'Active', orderedBy: 'Author', orderTime: '2026-10-20T00:00:00Z', ...overrides,
});

describe('Case Builder MAR authoring', () => {
  it('exposes exactly the supported history choices', () => expect(MAR_HISTORY_OPTIONS).toEqual([12, 24, 36, 48, 60, 72]));
  it('fingerprints the authored medication set deterministically and changes when metadata changes', () => {
    const first = orderDefinitionFingerprint([order(), order({ id: 'med-2', orderName: 'Second' })]);
    expect(orderDefinitionFingerprint([order({ id: 'med-2', orderName: 'Second' }), order()])).toBe(first);
    expect(orderDefinitionFingerprint([order({ dose: '20 mg' }), order({ id: 'med-2', orderName: 'Second' })])).not.toBe(first);
  });
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
    expect(result.events.map((event) => [event.status, event.relativeOffsetHours])).toEqual([
      ['Started', 12], ['Rate changed', 6], ['Stopped', 2],
    ]);
    expect(result.events.every((event) => event.category === 'infusion')).toBe(true);
    expect(result.events.find((event) => event.status === 'Started')?.relativeOffsetHours)
      .toBeGreaterThan(result.events.find((event) => event.status === 'Stopped')?.relativeOffsetHours ?? 0);
  });
  it('upserts an existing authored occurrence, preserving its identity while saving manual edits', () => {
    const result = buildCaseMarPreview([order()], { 'med-1': { ...defaultCaseMedicationDraft(order()), startPriorHours: '12' } }, 12);
    const existing = [{ ...result.events[0], id: 'saved', status: 'Held' as const, patientId: 'patient-1', roomId: 7, source: 'authored_scenario' as const, recordVersion: 2 }];
    const saved = authoredEventsToSave(result.events, existing, 'patient-1', 7, 'baseline-v1', 'Author');
    expect(saved).toHaveLength(3);
    expect(saved.find((event) => event.occurrenceKey === existing[0].occurrenceKey)).toMatchObject({ id: 'saved', status: 'Given' });
  });

  it('keeps preview edits attached to occurrenceKey', () => {
    const preview = buildCaseMarPreview([order()], { 'med-1': defaultCaseMedicationDraft(order()) }, 12);
    const edited = updatePreviewEvent(preview, preview.events[0].occurrenceKey, { status: 'Held', reason: 'Author note', relativeOffsetHours: 10 });
    expect(mergePreviewWithExisting(edited.events, []) [0]).toMatchObject({ occurrenceKey: preview.events[0].occurrenceKey, status: 'Held', reason: 'Author note', relativeOffsetHours: 10 });
  });

  it('recognizes only room-scoped authored medication content', () => {
    expect(isRoomScopedAuthoredOrder(order({ roomId: 7, overrideScope: 'room' }), 7)).toBe(true);
    expect(isRoomScopedAuthoredOrder(order({ roomId: 7, assignmentId: 'learner', overrideScope: 'assignment' }), 7)).toBe(false);
    const event = { ...buildCaseMarPreview([order()], { 'med-1': defaultCaseMedicationDraft(order()) }, 12).events[0], id: 'event-1', patientId: 'patient-1', roomId: 7, recordVersion: 1, source: 'authored_scenario' as const };
    expect(isRoomScopedAuthoredEvent(event, 7)).toBe(true);
    expect(isRoomScopedAuthoredEvent({ ...event, assignmentId: 'learner' }, 7)).toBe(false);
  });
});
