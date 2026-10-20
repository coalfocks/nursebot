import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CaseBuilderMarAuthoring from './CaseBuilderMarAuthoring';

const { api } = vi.hoisted(() => ({ api: {
  getPatientByRoomId: vi.fn(), getRoomContext: vi.fn(), listOrders: vi.fn(), listMarEvents: vi.fn(), getMarHistoryRevision: vi.fn(), getMarReadiness: vi.fn(), saveMarHistory: vi.fn(),
} }));

vi.mock('../lib/api', () => ({ emrApi: api }));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ profile: { id: 'author-1', role: 'school_admin', school_id: 'school-1', full_name: 'Author' } }) }));

describe('Case Builder MAR authoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    api.getPatientByRoomId.mockResolvedValue({ id: 'patient-1', roomId: 7, mrn: 'MRN-1', firstName: 'Test', lastName: 'Patient', dateOfBirth: '1980-01-01', gender: 'Other', allergies: [] });
    api.getRoomContext.mockResolvedValue({ data: { hospital_stay_days: 1 }, error: null });
    api.listOrders.mockResolvedValue([{ id: 'med-1', patientId: 'patient-1', roomId: 7, assignmentId: null, overrideScope: 'room', category: 'Medication', orderName: 'Example', dose: '10 mg', route: 'PO', frequency: 'q4h', priority: 'Routine', status: 'Active', orderedBy: 'Author', orderTime: '2026-10-20T00:00:00Z' }]);
    api.listMarEvents.mockResolvedValue([]);
    api.getMarHistoryRevision.mockResolvedValue(0);
    api.getMarReadiness.mockResolvedValue(true);
  });

  it('keeps Generate MAR Given preview-only and does not write', async () => {
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    expect(api.saveMarHistory).not.toHaveBeenCalled();
    expect(view.getByText(/Preview generated locally/)).toBeInTheDocument();
    expect(view.getByRole('spinbutton', { name: /:scheduled:12 time/i })).toHaveValue(12);
  });

  it('keeps the authorized list and local hypothetical preview usable when MAR persistence is unavailable', async () => {
    api.getMarReadiness.mockResolvedValue(false);
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    expect(view.getByRole('status')).toHaveTextContent(/Local preview only/);
    expect(view.getByRole('button', { name: /Add medication/i })).toBeDisabled();
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    expect(view.getByText(/Preview generated locally/)).toBeInTheDocument();
    expect(view.getByText(/local hypothetical preview/)).toBeInTheDocument();
    expect(api.saveMarHistory).not.toHaveBeenCalled();
  });

  it('labels a failed history read unavailable instead of treating it as an empty baseline', async () => {
    api.listMarEvents.mockImplementation(async (...args: unknown[]) => {
      (args[4] as ((message: string) => void) | undefined)?.('history unavailable');
      return [];
    });
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    expect(view.getByRole('status')).toHaveTextContent(/Saved MAR history is unavailable, not empty/);
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    fireEvent.click(view.getByRole('button', { name: /Save authored MAR/i }));
    expect(api.saveMarHistory).not.toHaveBeenCalled();
  });

  it('allows authored preview edits and keeps them keyed to the occurrence', async () => {
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    const dose = view.getByRole('textbox', { name: /med-1:scheduled:12 dose/i });
    fireEvent.change(dose, { target: { value: '15 mg' } });
    expect(dose).toHaveValue('15 mg');
    expect(JSON.parse(window.localStorage.getItem('case-builder-mar:7:preview') ?? '{}').events[0]).toMatchObject({ occurrenceKey: 'med-1:scheduled:12', orderedDose: '15 mg' });
  });

  it('blocks Save and shows the edited-row error for an invalid time', async () => {
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    fireEvent.change(view.getByRole('spinbutton', { name: /med-1:scheduled:12 time/i }), { target: { value: '0' } });
    expect(view.getByText(/MAR_TIME_MUST_PRECEDE_FIRST_PAGE/)).toBeInTheDocument();
    expect(view.getByRole('button', { name: /Save authored MAR/i })).toBeDisabled();
    expect(api.saveMarHistory).not.toHaveBeenCalled();
  });

  it('uses the persisted generation request id for a retry and clears it only after success', async () => {
    api.saveMarHistory.mockResolvedValueOnce({ ok: false, error: 'unknown outcome' }).mockResolvedValueOnce({ ok: true, revision: 1 });
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    fireEvent.click(view.getByRole('button', { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalledTimes(1));
    const requestId = api.saveMarHistory.mock.calls[0][6];
    expect(window.localStorage.getItem('case-builder-mar:7:generation-request-id')).toBe(JSON.stringify(requestId));
    fireEvent.click(view.getByRole('button', { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalledTimes(2));
    expect(api.saveMarHistory.mock.calls[1][6]).toBe(requestId);
    expect(api.saveMarHistory.mock.calls[1][5]).toEqual(api.saveMarHistory.mock.calls[0][5]);
    await waitFor(() => expect(window.localStorage.getItem('case-builder-mar:7:generation-request-id')).toBeNull());
  });

  it('rotates request identity and payload after editing a failed preview', async () => {
    api.saveMarHistory.mockResolvedValueOnce({ ok: false, error: 'unknown outcome' }).mockResolvedValueOnce({ ok: true, revision: 1 });
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    fireEvent.click(view.getByRole('button', { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalledTimes(1));
    const oldRequestId = api.saveMarHistory.mock.calls[0][6];
    const dose = view.getByRole('textbox', { name: /med-1:scheduled:12 dose/i });
    fireEvent.change(dose, { target: { value: '15 mg' } });
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('case-builder-mar:7:preview') ?? '{}').requestId).not.toBe(oldRequestId));
    const newRequestId = JSON.parse(window.localStorage.getItem('case-builder-mar:7:preview') ?? '{}').requestId;
    expect(newRequestId).not.toBe(oldRequestId);
    fireEvent.click(view.getByRole('button', { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalledTimes(2));
    expect(api.saveMarHistory.mock.calls[1][6]).toBe(newRequestId);
    expect(api.saveMarHistory.mock.calls[1][5]).not.toEqual(api.saveMarHistory.mock.calls[0][5]);
    expect(api.saveMarHistory.mock.calls[1][5][0]).toMatchObject({ orderedDose: '15 mg', administeredDose: '15 mg' });
  });

  it('discards a persisted preview and request when authored medication metadata changes', async () => {
    const first = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(first.getByText('Example')).toBeInTheDocument());
    fireEvent.click(first.getByRole('button', { name: /Generate MAR Given/i }));
    await waitFor(() => expect(window.localStorage.getItem('case-builder-mar:7:preview')).not.toBeNull());
    first.unmount();
    api.listOrders.mockResolvedValue([{ id: 'med-1', patientId: 'patient-1', roomId: 7, assignmentId: null, overrideScope: 'room', category: 'Medication', orderName: 'Example', dose: '20 mg', route: 'PO', frequency: 'q4h', priority: 'Routine', status: 'Active', orderedBy: 'Author', orderTime: '2026-10-20T00:00:00Z' }]);
    const second = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(second.getByText('Example')).toBeInTheDocument());
    expect(second.getByText(/Choose timings, then Generate MAR Given/)).toBeInTheDocument();
    expect(window.localStorage.getItem('case-builder-mar:7:preview')).toBeNull();
    expect(window.localStorage.getItem('case-builder-mar:7:generation-request-id')).toBeNull();
  });

  it('excludes learner-scoped orders and events from authored loading and saving', async () => {
    api.saveMarHistory.mockResolvedValue({ ok: true, revision: 1 });
    api.listOrders.mockResolvedValueOnce([
      { id: 'med-1', patientId: 'patient-1', roomId: 7, assignmentId: null, overrideScope: 'room', category: 'Medication', orderName: 'Example', dose: '10 mg', route: 'PO', frequency: 'q4h', priority: 'Routine', status: 'Active', orderedBy: 'Author', orderTime: '2026-10-20T00:00:00Z' },
      { id: 'learner-med', patientId: 'patient-1', roomId: 7, assignmentId: 'assignment-1', overrideScope: 'assignment', category: 'Medication', orderName: 'Learner only', dose: '1 mg', route: 'PO', frequency: 'once', priority: 'Routine', status: 'Active', orderedBy: 'Learner', orderTime: '2026-10-20T00:00:00Z' },
    ]);
    api.listMarEvents.mockResolvedValueOnce([{ id: 'learner-event', patientId: 'patient-1', roomId: 7, assignmentId: 'assignment-1', occurrenceKey: 'learner', medicationName: 'Learner only', category: 'scheduled', status: 'Given', source: 'learner', recordVersion: 1 }]);
    const view = render(<MemoryRouter initialEntries={['/case-builder/mar?roomId=7']}><CaseBuilderMarAuthoring /></MemoryRouter>);
    await waitFor(() => expect(view.getByText('Example')).toBeInTheDocument());
    expect(view.queryByText('Learner only')).not.toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: /Generate MAR Given/i }));
    fireEvent.click(view.getByRole('button', { name: /Save authored MAR/i }));
    await waitFor(() => expect(api.saveMarHistory).toHaveBeenCalled());
    expect(api.saveMarHistory.mock.calls[0][5]).not.toEqual(expect.arrayContaining([expect.objectContaining({ medicationName: 'Learner only' })]));
  });
});
