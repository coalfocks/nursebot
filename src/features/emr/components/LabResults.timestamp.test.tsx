import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LabResults } from './LabResults';
import type { LabResult, Patient } from '../lib/types';

vi.mock('../lib/api', () => ({
  emrApi: {
    listLabResults: vi.fn().mockResolvedValue([]),
    listOrders: vi.fn().mockResolvedValue([]),
    listClinicalNotes: vi.fn().mockResolvedValue([]),
    listVitals: vi.fn().mockResolvedValue([]),
    getRoomContext: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({ profile: null }),
}));

vi.mock('../../../lib/roles', () => ({
  isSuperAdmin: () => false,
}));

vi.mock('../lib/aiLabGenerator', () => ({
  generateLabResults: vi.fn(),
  resolveLabTemplates: vi.fn().mockReturnValue([]),
  validateGeneratedLabResults: vi.fn().mockReturnValue([]),
}));

vi.mock('../lib/labCatalog', () => ({ instantLabs: [], pendingLabs: [] }));
vi.mock('../lib/labOrderEligibility', () => ({ isResultProducingStatLab: () => false }));
vi.mock('../lib/labIntegrity', () => ({ normalizeLabResultForPatient: (lab: LabResult) => lab }));

const patient: Patient = {
  id: 'patient-203',
  mrn: 'MRN-203',
  firstName: 'Test',
  lastName: 'Patient',
  dateOfBirth: '1980-01-01',
  gender: 'Other',
  allergies: [],
  admissionDate: '2026-10-29T22:00:00.000Z',
};

const lab = (id: string, testName: string, collectionTime: string, resultTime = collectionTime, relativeOffsetHours?: number): LabResult => ({
  id,
  patientId: patient.id,
  testName,
  value: id,
  unit: 'mmHg',
  referenceRange: 'reference',
  status: 'Normal',
  collectionTime,
  resultTime,
  orderedBy: 'Nurse',
  relativeOffsetHours,
});

describe('LabResults recorded timestamps', () => {
  it('keeps a baseline and two fresh batches anchored to their stored times', async () => {
    const baseline = lab('baseline', 'Baseline CBC', '2000-01-01T00:00:00.000Z', undefined, 12);
    const firstBatch = lab('abg', 'ABG pH', '2026-10-29T22:25:18.428Z', undefined, 0);
    const secondBatch = lab('cbc', 'CBC WBC', '2026-10-29T22:40:18.428Z', undefined, 0);

    const { rerender } = render(
      <LabResults patient={patient} isSandbox sandboxLabs={[baseline]} />,
    );
    await waitFor(() => expect(screen.getByText('Baseline CBC')).toBeInTheDocument());

    rerender(<LabResults patient={patient} isSandbox sandboxLabs={[baseline, firstBatch]} />);
    await waitFor(() => expect(screen.getByText('ABG pH')).toBeInTheDocument());
    expect(screen.getAllByText('12 hours prior').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Now').length).toBeGreaterThan(0);

    rerender(<LabResults patient={patient} isSandbox sandboxLabs={[baseline, firstBatch, secondBatch]} />);
    await waitFor(() => expect(screen.getByText('CBC WBC')).toBeInTheDocument());

    expect(screen.getAllByText('12 hours prior').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Now').length).toBeGreaterThan(0);
  });
});
