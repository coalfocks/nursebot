import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CaseBuilderMarAuthoring from './CaseBuilderMarAuthoring';

const { api } = vi.hoisted(() => ({ api: {
  getPatientByRoomId: vi.fn(), listOrders: vi.fn(), listMarEvents: vi.fn(), getMarHistoryRevision: vi.fn(), saveMarHistory: vi.fn(),
} }));

vi.mock('../lib/api', () => ({ emrApi: api }));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ profile: { id: 'author-1', role: 'school_admin', school_id: 'school-1', full_name: 'Author' } }) }));

describe('Case Builder MAR authoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPatientByRoomId.mockResolvedValue({ id: 'patient-1', roomId: 7, mrn: 'MRN-1', firstName: 'Test', lastName: 'Patient', dateOfBirth: '1980-01-01', gender: 'Other', allergies: [] });
    api.listOrders.mockResolvedValue([{ id: 'med-1', patientId: 'patient-1', roomId: 7, assignmentId: null, category: 'Medication', orderName: 'Example', dose: '10 mg', route: 'PO', frequency: 'q4h', priority: 'Routine', status: 'Active', orderedBy: 'Author', orderTime: '2026-10-20T00:00:00Z' }]);
    api.listMarEvents.mockResolvedValue([]);
    api.getMarHistoryRevision.mockResolvedValue(0);
  });

  it('keeps Generate MAR Given preview-only and does not write', async () => {
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    expect(api.saveMarHistory).not.toHaveBeenCalled();
    expect(view.getByText(/Preview generated locally/)).toBeInTheDocument();
    expect(view.getByText('12')).toBeInTheDocument();
  });
});
