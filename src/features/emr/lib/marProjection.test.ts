import { describe, expect, it } from 'vitest';
import { projectMedicationRows } from './marProjection';
import type { MedicalOrder, Patient } from './types';

const patient: Patient = { id: 'p1', roomId: 7, mrn: 'm1', firstName: 'A', lastName: 'B', dateOfBirth: '1980-01-01', gender: 'Other', allergies: [] };
const order = (frequency: string, instructions?: string): MedicalOrder => ({ id: `order-${frequency}`, patientId: 'p1', roomId: 7, orderName: `Medication ${frequency}`, frequency, instructions, route: 'PO', dose: '10 mg', category: 'Medication', priority: 'Routine', status: 'Active', orderedBy: 'Doctor', orderTime: '2026-10-19T12:00:00Z' });

describe('MAR medication projection', () => {
  it('keeps an order row visible without inventing a history event', () => {
    const rows = projectMedicationRows([], [order('q4h')], patient, 'v1', 'all', '');
    expect(rows).toHaveLength(1);
    expect(rows[0].orderOnly).toBe(true);
    expect(rows[0].administrations).toEqual([]);
    expect(rows[0].representative.status).toBe('Not documented');
  });

  it('keeps PRN order rows independent of the history filter', () => {
    const rows = projectMedicationRows([], [order('q4h', 'Give PRN for symptoms')], patient, 'v1', 'prn', '');
    expect(rows).toHaveLength(1);
    expect(rows[0].administrations).toHaveLength(0);
  });

  it('uses current order metadata while preserving older administration details', () => {
    const current = { ...order('q4h', 'Give PRN for symptoms'), dose: '20 mg', route: 'PO', id: 'order-current' };
    const historical = {
      id: 'event-old', patientId: 'p1', roomId: 7, assignmentId: 'a1', orderId: 'order-current', caseVersion: 'v1',
      occurrenceKey: 'old', relativeOffsetHours: 24, administeredAt: null, medicationName: current.orderName,
      orderedDose: '10 mg', administeredDose: '10 mg', unit: 'mg', route: 'IV', frequency: 'q6h', category: 'prn' as const,
      status: 'Given' as const, source: 'authored_scenario' as const,
    };
    const rows = projectMedicationRows([historical], [current], patient, 'v1', 'all', '');
    expect(rows[0].representative.orderedDose).toBe('20 mg');
    expect(rows[0].representative.route).toBe('PO');
    expect(rows[0].administrations[0].administeredDose).toBe('10 mg');
    expect(rows[0].administrations[0].route).toBe('IV');
  });
});
