import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LabResults } from './LabResults';
import type { Patient } from '../lib/types';

const { invoke, addLabResults, listOrders } = vi.hoisted(() => ({
  invoke: vi.fn(),
  addLabResults: vi.fn(),
  listOrders: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke } },
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({ profile: null }),
}));
vi.mock('../lib/api', () => ({
  emrApi: {
    listLabResults: vi.fn(async () => []),
    getRoomContext: vi.fn(async () => ({ data: { id: 7, emr_context: null }, error: null })),
    listOrders,
    listClinicalNotes: vi.fn(async () => []),
    listVitals: vi.fn(async () => []),
    addLabResults,
  },
}));

const patient: Patient = {
  id: 'patient-1', roomId: 7, mrn: 'MRN-1', firstName: 'Test', lastName: 'Patient',
  dateOfBirth: '1980-01-01', gender: 'Other', allergies: [],
};

describe('LabResults completed-review write barrier', () => {
  it('does not invoke or persist when mounted read-only', async () => {
    render(<LabResults patient={patient} assignmentId="assignment-1" readOnly />);
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
    expect(addLabResults).not.toHaveBeenCalled();
  });

  it('invalidates a writable reconciliation when review becomes read-only mid-request', async () => {
    let resolveOrders: ((orders: unknown[]) => void) | undefined;
    listOrders.mockImplementationOnce(() => new Promise((resolve) => { resolveOrders = resolve; }));
    const view = render(<LabResults patient={patient} assignmentId="assignment-1" readOnly={false} />);
    await waitFor(() => expect(listOrders).toHaveBeenCalled());
    view.rerender(<LabResults patient={patient} assignmentId="assignment-1" readOnly />);
    resolveOrders?.([]);
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
    expect(addLabResults).not.toHaveBeenCalled();
  });

  it('ignores a writable reconciliation that resolves after assignment switch', async () => {
    let resolveOrders: ((orders: unknown[]) => void) | undefined;
    listOrders.mockImplementationOnce(() => new Promise((resolve) => { resolveOrders = resolve; }));
    const view = render(<LabResults patient={patient} assignmentId="assignment-1" readOnly={false} />);
    await waitFor(() => expect(listOrders).toHaveBeenCalled());
    view.rerender(<LabResults patient={patient} assignmentId="assignment-2" readOnly />);
    resolveOrders?.([]);
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
    expect(addLabResults).not.toHaveBeenCalled();
  });
});
