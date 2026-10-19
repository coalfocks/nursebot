import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicationAdministrationRecord } from './MedicationAdministrationRecord';
import type { Patient } from '../lib/types';

const { api, profileState } = vi.hoisted(() => ({
  api: {
    getMarNormalMaterializationReadiness: vi.fn(),
    listMarEvents: vi.fn(),
    listOrders: vi.fn(),
    listMarMedicationOrders: vi.fn(),
    getMarHistoryRevision: vi.fn(),
    getMarBaselineVersion: vi.fn(),
    getMarPublicationPreview: vi.fn(),
    getMarPublicationStatus: vi.fn(),
    publishMarCaseVersion: vi.fn(),
    saveMarHistory: vi.fn(),
  },
  profileState: { current: { id: 'actor-a', role: 'school_admin', school_id: 'school-a', full_name: 'Author A' } },
}));

vi.mock('../lib/api', () => ({
  emrApi: api,
  marRpcErrorMessage: (error: unknown) => error instanceof Error ? error.message : (error as { message?: string })?.message ?? 'Unable to complete the MAR request.',
}));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ profile: profileState.current }) }));

const patient = (id: string): Patient => ({
  id, roomId: 7, mrn: `MRN-${id}`, firstName: 'Test', lastName: id,
  dateOfBirth: '1980-01-01', gender: 'Other', allergies: [],
});

describe('MedicationAdministrationRecord scope fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileState.current = { id: 'actor-a', role: 'school_admin', school_id: 'school-a', full_name: 'Author A' };
    api.getMarNormalMaterializationReadiness.mockResolvedValue({ ready: true, materializationVersion: 5, publicationPreviewVersion: 5, atomic: true });
    api.listMarEvents.mockResolvedValue([]);
    api.listOrders.mockResolvedValue([{ id: 'order-a', patientId: 'patient-a', roomId: 7, assignmentId: null, category: 'Medication', orderName: 'Medication A', dose: '20', route: 'PO', frequency: 'q4h' }]);
    api.listMarMedicationOrders.mockResolvedValue([{ id: 'order-a', patientId: 'patient-a', roomId: 7, assignmentId: null, category: 'Medication', orderName: 'Medication A', dose: '20', route: 'PO', frequency: 'q4h' }]);
    api.getMarHistoryRevision.mockResolvedValue(0);
    api.getMarBaselineVersion.mockResolvedValue(null);
    api.getMarPublicationPreview.mockResolvedValue({ revision: 0, contentHash: 'preview-hash', orderCount: 1, eventCount: 0 });
    api.publishMarCaseVersion.mockResolvedValue({ caseVersion: 'room-7-mar-v2', contentHash: 'preview-hash', orderCount: 1, eventCount: 0, revision: 0, requestId: 'publication-1' });
  });

  it('clears an open manual draft when patient scope changes', async () => {
    const view = render(<MedicationAdministrationRecord patient={patient('patient-a')} assignmentId="assignment-a" caseVersion="room-7-mar-v1" />);
    await waitFor(() => expect(view.getByRole('button', { name: /add administration/i })).toBeEnabled());
    fireEvent.click(view.getByRole('button', { name: /add administration/i }));
    fireEvent.change(view.getByLabelText('Medication name'), { target: { value: 'Wrong patient draft' } });
    view.rerender(<MedicationAdministrationRecord patient={patient('patient-b')} assignmentId="assignment-b" caseVersion="room-7-mar-v2" />);
    await waitFor(() => expect(view.queryByLabelText('Medication name')).not.toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: /add administration/i }));
    expect(view.getByLabelText('Medication name')).toHaveValue('');
  });

  it('does not apply a deferred load from the prior actor/scope', async () => {
    let resolveEvents: ((events: unknown[]) => void) | undefined;
    api.listMarEvents.mockImplementationOnce(() => new Promise((resolve) => { resolveEvents = resolve; }));
    const view = render(<MedicationAdministrationRecord patient={patient('patient-a')} assignmentId="assignment-a" caseVersion="room-7-mar-v1" />);
    await waitFor(() => expect(api.listMarEvents).toHaveBeenCalled());
    profileState.current = { id: 'actor-b', role: 'school_admin', school_id: 'school-b', full_name: 'Author B' };
    view.rerender(<MedicationAdministrationRecord patient={patient('patient-b')} assignmentId="assignment-b" caseVersion="room-7-mar-v2" />);
    resolveEvents?.([{ id: 'old-event', patientId: 'patient-a', roomId: 7, assignmentId: 'assignment-a', orderId: null, caseVersion: 'room-7-mar-v1', occurrenceKey: 'old', relativeOffsetHours: 12, administeredAt: null, medicationName: 'Old', orderedDose: '1', administeredDose: '1', unit: 'mg', route: 'PO', frequency: 'once', category: 'one_time', status: 'Given', source: 'authored_scenario' }]);
    await waitFor(() => expect(view.queryByText('Old')).not.toBeInTheDocument());
  });

  it('binds publication to the composite preview and releases a confirmed revision conflict', async () => {
    api.publishMarCaseVersion.mockRejectedValueOnce({ message: 'MAR_PUBLICATION_REVISION_CONFLICT', code: 'P0001' });
    const view = render(<MedicationAdministrationRecord patient={patient('patient-a')} forceBaseline />);
    await waitFor(() => expect(view.getByRole('button', { name: /publish mar version/i })).toBeEnabled());
    fireEvent.click(view.getByRole('button', { name: /publish mar version/i }));
    await waitFor(() => expect(api.publishMarCaseVersion).not.toHaveBeenCalled());
    fireEvent.click(view.getByRole('button', { name: /publish mar version/i }));
    await waitFor(() => expect(api.publishMarCaseVersion).toHaveBeenCalledWith(7, expect.objectContaining({ expectedRevision: 0, expectedContentHash: 'preview-hash' })));
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(/No version was published/));
    expect(view.queryByText(/awaiting confirmation/i)).not.toBeInTheDocument();
  });

  it('keeps an unknown publication pending when reconciliation cannot verify a receipt', async () => {
    api.publishMarCaseVersion.mockRejectedValueOnce(new Error('Failed to fetch'));
    api.getMarPublicationStatus.mockRejectedValueOnce({ message: 'Failed to fetch', code: 'NETWORK' });
    const view = render(<MedicationAdministrationRecord patient={patient('patient-a')} forceBaseline />);
    await waitFor(() => expect(view.getByRole('button', { name: /publish mar version/i })).toBeEnabled());
    fireEvent.click(view.getByRole('button', { name: /publish mar version/i }));
    await waitFor(() => expect(view.getByRole('button', { name: /publish mar version/i })).toBeEnabled());
    fireEvent.click(view.getByRole('button', { name: /publish mar version/i }));
    await waitFor(() => expect(view.getByText(/outcome is unknown/i)).toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: /reload preview/i }));
    await waitFor(() => expect(view.getByText(/outcome is still unknown/i)).toBeInTheDocument());
    expect(window.localStorage.length).toBeGreaterThan(0);
  });

  it('fails closed for the v4 partial upgrade until the publication-preview contract is present', async () => {
    api.getMarNormalMaterializationReadiness.mockResolvedValueOnce({ ready: true, materializationVersion: 4, publicationPreviewVersion: 4, atomic: true });
    const view = render(<MedicationAdministrationRecord patient={patient('patient-a')} forceBaseline />);
    await waitFor(() => expect(view.getByText(/awaiting mar setup/i)).toBeInTheDocument());
    expect(view.queryByRole('button', { name: /publish mar version/i })).not.toBeInTheDocument();
    expect(api.listMarEvents).not.toHaveBeenCalled();
  });
});
