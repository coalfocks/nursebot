import { describe, expect, it } from 'vitest';
import { buildMissingCompletedLabResults } from './completedLabReconciliation';
import type { LabResult, MedicalOrder, Patient } from './types';

const patient: Patient = {
  id: 'patient-1',
  roomId: 42,
  mrn: 'MRN-1',
  firstName: 'Test',
  lastName: 'Patient',
  dateOfBirth: '1990-01-01',
  gender: 'Other',
  allergies: [],
};

const order: MedicalOrder = {
  id: 'order-1',
  patientId: patient.id,
  assignmentId: 'assignment-1',
  roomId: patient.roomId,
  overrideScope: 'assignment',
  category: 'Lab',
  orderName: 'CBC',
  priority: 'STAT',
  status: 'Completed',
  orderedBy: 'Student',
  orderTime: '2026-10-16T10:15:00.000Z',
};

const template = { testName: 'Hemoglobin', unit: 'g/dL', referenceRange: '12.0-15.5' };

describe('completed assignment lab reconciliation', () => {
  it('creates only the missing CBC result with assignment scope and order timestamp', () => {
    const existing: LabResult = {
      id: 'existing',
      patientId: patient.id,
      assignmentId: 'assignment-1',
      roomId: patient.roomId,
      testName: 'Hematocrit',
      value: 40,
      unit: '%',
      referenceRange: '36-46',
      status: 'Normal',
      collectionTime: order.orderTime,
      orderedBy: 'Student',
    };
    const results = buildMissingCompletedLabResults({
      order,
      patient,
      assignmentId: 'assignment-1',
      existingLabs: [existing],
      generatedLabs: [{ ...existing, id: 'generated', testName: 'Hemoglobin', value: 13.2, unit: 'g/dL' }],
      templates: [template],
    });

    expect(results).toEqual([expect.objectContaining({
      assignmentId: 'assignment-1',
      roomId: 42,
      overrideScope: 'assignment',
      testName: 'Hemoglobin',
      value: 13.2,
      collectionTime: order.orderTime,
      resultTime: order.orderTime,
    })]);
  });

  it('is idempotent once the assignment-scoped result exists', () => {
    const result: LabResult = {
      id: 'existing',
      patientId: patient.id,
      assignmentId: 'assignment-1',
      roomId: patient.roomId,
      testName: template.testName,
      value: 13.2,
      unit: template.unit,
      referenceRange: template.referenceRange,
      status: 'Normal',
      collectionTime: order.orderTime,
      orderedBy: 'Student',
    };
    expect(buildMissingCompletedLabResults({
      order,
      patient,
      assignmentId: 'assignment-1',
      existingLabs: [result],
      generatedLabs: [],
      templates: [template],
    })).toEqual([]);
  });
});
