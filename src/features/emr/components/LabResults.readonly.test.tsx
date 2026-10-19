import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('../lib/aiLabGenerator', () => ({
  resolveLabTemplates: vi.fn(() => [{ testName: 'CBC', unit: 'x', referenceRange: '1-2' }]),
  validateGeneratedLabResults: vi.fn((results: unknown[]) => results),
}));

const patient: Patient = {
  id: 'patient-1', roomId: 7, mrn: 'MRN-1', firstName: 'Test', lastName: 'Patient',
  dateOfBirth: '1980-01-01', gender: 'Other', allergies: [],
};

describe('LabResults completed-review write barrier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOrders.mockResolvedValue([]);
    addLabResults.mockResolvedValue({ ok: true });
    invoke.mockResolvedValue({ data: { labs: [{ testName: 'CBC', value: 1, unit: 'x', referenceRange: '1-2' }] }, error: null });
  });
  it('does not invoke or persist when mounted read-only', async () => {
    render(<LabResults patient={patient} assignmentId="assignment-1" readOnly />);
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
    expect(addLabResults).not.toHaveBeenCalled();
  });

  it('invalidates a writable reconciliation when review becomes read-only mid-request', async () => {
    let resolveOrders: ((orders: unknown[]) => void) | undefined;
    listOrders.mockImplementationOnce(() => new Promise((resolve) => { resolveOrders = resolve; }));
    const view = render(<LabResults patient={patient} assignmentId="assignment-1" assignmentStatus="in_progress" assignmentStatusKey="assignment-1" readOnly={false} />);
    await waitFor(() => expect(listOrders).toHaveBeenCalled());
    await act(async () => {
      view.rerender(<LabResults patient={patient} assignmentId="assignment-2" assignmentStatus="completed" assignmentStatusKey="assignment-2" readOnly />);
      resolveOrders?.([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
    expect(addLabResults).not.toHaveBeenCalled();
  });

  it('ignores a writable reconciliation that resolves after assignment switch', async () => {
    let resolveOrders: ((orders: unknown[]) => void) | undefined;
    listOrders.mockImplementationOnce(() => new Promise((resolve) => { resolveOrders = resolve; }));
    const view = render(<LabResults patient={patient} assignmentId="assignment-1" assignmentStatus="in_progress" assignmentStatusKey="assignment-1" readOnly={false} />);
    await waitFor(() => expect(listOrders).toHaveBeenCalled());
    await act(async () => {
      view.rerender(<LabResults patient={patient} assignmentId="assignment-2" assignmentStatus="completed" assignmentStatusKey="assignment-1" readOnly />);
      resolveOrders?.([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
    expect(addLabResults).not.toHaveBeenCalled();
  });

  it('proves an eligible writable order invokes and persists exactly once', async () => {
    listOrders.mockResolvedValueOnce([{
      id: 'order-1', patientId: 'patient-1', assignmentId: 'assignment-1', roomId: 7,
      category: 'Lab', orderName: 'CBC', priority: 'STAT', status: 'Active', orderedBy: 'Doctor', orderTime: new Date().toISOString(),
    }]);
    render(<LabResults patient={patient} assignmentId="assignment-1" assignmentStatus="in_progress" assignmentStatusKey="assignment-1" readOnly={false} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(addLabResults).toHaveBeenCalledTimes(1));
  });

  it('pauses at the in-flight generator and never persists after read-only transition', async () => {
    let resolveInvoke: ((value: unknown) => void) | undefined;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveInvoke = resolve; }));
    listOrders.mockResolvedValueOnce([{
      id: 'order-2', patientId: 'patient-1', assignmentId: 'assignment-1', roomId: 7,
      category: 'Lab', orderName: 'CBC', priority: 'STAT', status: 'Active', orderedBy: 'Doctor', orderTime: new Date().toISOString(),
    }]);
    const view = render(<LabResults patient={patient} assignmentId="assignment-1" assignmentStatus="in_progress" assignmentStatusKey="assignment-1" readOnly={false} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(addLabResults).not.toHaveBeenCalled();
    await act(async () => {
      view.rerender(<LabResults patient={patient} assignmentId="assignment-1" readOnly />);
      await Promise.resolve();
    });
    await act(async () => {
      resolveInvoke?.({ data: { labs: [{ testName: 'CBC', value: 1, unit: 'x', referenceRange: '1-2' }] }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(addLabResults).not.toHaveBeenCalled());
  });
});
