import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import RoomEditor from './RoomEditor';

const { updateRoom, rpc, availabilityState, roomInsertResponse, patientInsertResponse, roomReadbackState } = vi.hoisted(() => ({
  updateRoom: vi.fn(),
  rpc: vi.fn(),
  roomInsertResponse: { data: { id: 305, room_number: '305', school_id: 'school-1' }, error: null } as { data: unknown; error: unknown },
  patientInsertResponse: { data: { id: 'patient-new', school_id: 'school-1' }, error: null } as { data: unknown; error: unknown },
  availabilityState: {
    response: { data: { available_school_ids: ['school-1'], updated_at: '2026-10-17T00:00:00.000Z' }, error: null } as { data: unknown; error: unknown },
    pending: null as Promise<unknown> | null,
  },
  roomReadbackState: { current: null as { emr_context?: unknown; case_goals?: string | null; progress_note?: string | null; hospital_timeline?: unknown; hospital_stay_days?: number; encounter_type?: string } | null, conflict: false },
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(async () => ({
        data: table === 'rooms'
          ? (roomReadbackState.current ?? (roomReadbackState.conflict ? roomInsertResponse.data : { ...roomInsertResponse.data, emr_context: updateRoom.mock.calls.at(-1)?.[0]?.emr_context }))
          : null,
        error: null,
      }));
      builder.single = vi.fn(async () => table === 'rooms' ? roomInsertResponse : table === 'patients' ? patientInsertResponse : ({ data: null, error: null }));
      builder.order = vi.fn(async () => ({ data: table === 'schools' || table === 'specialties' ? [] : [], error: null }));
      builder.or = vi.fn(() => builder);
      builder.update = vi.fn((payload: unknown) => {
        updateRoom(payload);
        if (!roomReadbackState.conflict && typeof payload === 'object' && payload && 'emr_context' in payload) {
          roomReadbackState.current = { emr_context: (payload as { emr_context: unknown }).emr_context };
        }
        const query = {
          eq: vi.fn(() => query),
          is: vi.fn(() => query),
          maybeSingle: vi.fn(async () => typeof payload === 'object' && payload && 'emr_context' in payload
            ? { data: roomReadbackState.conflict ? roomInsertResponse.data : { id: 204, emr_context: (payload as { emr_context: unknown }).emr_context }, error: null }
            : availabilityState.pending ?? availabilityState.response),
          select: vi.fn(() => query),
        };
        return query;
      });
      builder.insert = vi.fn(() => builder);
      return builder;
    },
    rpc,
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    profile: { id: 'admin-1', role: 'super_admin', school_id: 'school-1' },
    activeSchoolId: 'school-1',
  }),
}));

vi.mock('../hooks/useSchools', () => ({
  useSchools: () => ({ schools: [
    { id: 'school-1', name: 'Synthetic School', display_name: 'Synthetic School' },
    { id: 'school-2', name: 'University of Arizona SOM', display_name: 'University of Arizona SOM' },
  ] }),
  getSchoolDisplayName: (school: { name: string }) => school.name,
}));

const room = {
  id: 204,
  room_number: '204',
  school_id: 'school-1', learner_program: 'medical', role: 'student', objective: 'Objective', style: '',
  context: 'legacy nurse context', nurse_context: 'legacy nurse context',
  emr_context: JSON.stringify({
    context: 'old lab instructions', patientChat: { prompt: 'patient prompt', enabled: true },
    patient: { age: 19 }, event: { source: 'authored' }, orders: [{ name: 'CBC' }],
    vitals: { temperature: 37 }, evaluation: { goals: ['goal'] },
  }),
  specialty_id: null, specialty_ids: null, difficulty_level: null, expected_diagnosis: null,
  expected_treatment: null, case_goals: null, progress_note: null, completion_hint: null,
  bedside_hint: null, bedside_requirement: 'situational', patient_conversation_enabled: true,
  patient_conversation_prompt: null, consultant_response_prompt: null, orders_config: null,
  is_active: true, pdf_url: null, available_school_ids: ['school-1'], continues_from: null, updated_at: '2026-10-17T00:00:00.000Z',
    patient_id: null, initial_vitals: null, created_at: null,
  encounter_type: 'inpatient', hospital_stay_days: 1, hospital_timeline: { entries: [] },
} as never;

const renderEditor = (props: ComponentProps<typeof RoomEditor>) => render(
  <MemoryRouter initialEntries={['/rooms']}>
    <RoomEditor {...props} />
  </MemoryRouter>,
);

describe('RoomEditor EMR context control', () => {
  beforeEach(() => {
    updateRoom.mockReset();
    rpc.mockReset();
    window.localStorage.clear();
    availabilityState.pending = null;
    availabilityState.response = { data: { available_school_ids: ['school-1'], updated_at: '2026-10-17T00:00:00.000Z' }, error: null };
    roomInsertResponse.data = { id: 305, room_number: '305', school_id: 'school-1' };
    patientInsertResponse.data = { id: 'patient-new', school_id: 'school-1' };
    roomReadbackState.current = null;
    roomReadbackState.conflict = false;
  });

  it('bypasses native required Style and incomplete timeline validation', async () => {
    renderEditor({ room, onSave: vi.fn(), onCancel: vi.fn() });
    fireEvent.change(screen.getByLabelText('EHR Context'), { target: { value: 'new lab instructions' } });
    fireEvent.click(screen.getByTestId('save-emr-context'));

    await waitFor(() => expect(updateRoom).toHaveBeenCalledTimes(1));
    expect(updateRoom).toHaveBeenCalledWith({ emr_context: expect.stringContaining('new lab instructions') });
    expect(updateRoom.mock.calls[0][0]).not.toHaveProperty('style');
    expect(updateRoom.mock.calls[0][0]).not.toHaveProperty('hospital_timeline');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the EMR context readback loses the optimistic room revision', async () => {
    roomReadbackState.conflict = true;
    renderEditor({ room, onSave: vi.fn(), onCancel: vi.fn() });
    fireEvent.change(screen.getByLabelText('EHR Context'), { target: { value: 'concurrent edit' } });
    fireEvent.click(screen.getByTestId('save-emr-context'));

    await waitFor(() => expect(screen.getByText(/EMR context changed during save/)).toBeInTheDocument());
    expect(updateRoom).toHaveBeenCalledTimes(1);
  });

  it('saves only school availability with blank Style and invalid unchanged timeline', async () => {
    const onRoomPatch = vi.fn();
    availabilityState.response = { data: { available_school_ids: [], updated_at: '2026-10-17T00:00:00.000Z' }, error: null };
    renderEditor({ room, onSave: vi.fn(), onCancel: vi.fn(), onRoomPatch });
    fireEvent.click(screen.getByLabelText('Available to all schools'));
    fireEvent.click(screen.getByTestId('save-school-availability'));

    await waitFor(() => expect(updateRoom).toHaveBeenCalledTimes(1));
    expect(updateRoom).toHaveBeenCalledWith({ available_school_ids: [] });
    expect(updateRoom.mock.calls[0][0]).not.toHaveProperty('style');
    expect(updateRoom.mock.calls[0][0]).not.toHaveProperty('hospital_timeline');
    expect(rpc).not.toHaveBeenCalled();
    expect(onRoomPatch).toHaveBeenCalledWith(expect.objectContaining({ available_school_ids: [] }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved and read back: Specific schools → all schools');
  });

  it('saves goals and progress with an invalid unchanged legacy timeline and reads both fields back', async () => {
    const onRoomPatch = vi.fn();
    roomReadbackState.current = {
      case_goals: 'Acute cholecystitis goal',
      progress_note: 'Continue source-control planning.',
      hospital_timeline: room.hospital_timeline,
      hospital_stay_days: room.hospital_stay_days,
      encounter_type: room.encounter_type,
    };
    renderEditor({ room, onSave: vi.fn(), onCancel: vi.fn(), onRoomPatch });
    fireEvent.change(screen.getByLabelText('Goals of Case'), { target: { value: 'Acute cholecystitis goal' } });
    fireEvent.change(screen.getByLabelText('Progress Note'), { target: { value: 'Continue source-control planning.' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save Room' }).closest('form')!);

    await waitFor(() => expect(updateRoom).toHaveBeenCalledWith({
      case_goals: 'Acute cholecystitis goal',
      progress_note: 'Continue source-control planning.',
    }));
    expect(rpc).not.toHaveBeenCalled();
    expect(onRoomPatch).toHaveBeenCalledWith({ case_goals: 'Acute cholecystitis goal', progress_note: 'Continue source-control planning.' });
  });

  it('keeps timeline validation when the timeline-related form is also changed', async () => {
    renderEditor({ room, onSave: vi.fn(), onCancel: vi.fn() });
    fireEvent.change(screen.getByLabelText('Goals of Case'), { target: { value: 'Changed goal' } });
    fireEvent.change(screen.getByLabelText('Hospital stay days (1–3)'), { target: { value: '2' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save Room' }).closest('form')!);

    await waitFor(() => expect(screen.getAllByText(/Hospital day 1 requires one chronological progress note/).length).toBeGreaterThan(0));
    expect(updateRoom).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps the draft and reports a conflict when the room revision is stale', async () => {
    const onRoomPatch = vi.fn();
    availabilityState.response = { data: null, error: null };
    renderEditor({ room, onSave: vi.fn(), onCancel: vi.fn(), onRoomPatch });
    fireEvent.click(screen.getByTestId('save-school-availability'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Save conflict'));
    expect(onRoomPatch).not.toHaveBeenCalled();
  });

  it('allows only one in-flight availability save', async () => {
    let resolvePending!: (value: unknown) => void;
    availabilityState.pending = new Promise((resolve) => { resolvePending = resolve; });
    renderEditor({ room, onSave: vi.fn(), onCancel: vi.fn() });
    const button = screen.getByTestId('save-school-availability');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(updateRoom).toHaveBeenCalledTimes(1);

    resolvePending({ data: { available_school_ids: ['school-1'], updated_at: '2026-10-17T00:00:01.000Z' }, error: null });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved and read back'));
  });

  it('persists the complete recovery envelope across reload and retries the same IDs once', async () => {
    const recoveryRoom = {
      ...room,
      patient_id: 'patient-1',
      hospital_timeline: {
        encounterType: 'inpatient', stayDays: 1, priorContextHours: 12,
        entries: [
          { id: 'timeline-entry-1', kind: 'admission', hospitalDay: 1, relativeHoursBeforeEncounter: 24, title: 'Admission', content: 'Authored fixture' },
          { id: 'timeline-entry-2', kind: 'progress_note', hospitalDay: 1, relativeHoursBeforeEncounter: 12, title: 'Progress', content: 'Authored progress fixture' },
        ],
      },
    } as never;
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: '42P10', message: 'no unique or exclusion constraint matching the ON CONFLICT specification' } })
      .mockResolvedValueOnce({ data: { room_id: 204, patient_id: 'patient-1', timeline_entries: 1 }, error: null });

    const first = renderEditor({ room: recoveryRoom, onSave: vi.fn(), onCancel: vi.fn() });
    fireEvent.change(screen.getByLabelText('Room Number'), { target: { value: '205' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save Room' }).closest('form')!);

    await waitFor(() => expect(screen.getByText(/Room and patient saved, but hospital timeline publication failed/)).toBeInTheDocument());
    const stored = JSON.parse(window.localStorage.getItem('nursebot:timeline-publish-recovery:v1:admin-1:school-1') ?? 'null');
    expect(stored).toMatchObject({ version: 1, actorId: 'admin-1', roomId: 204, patientId: 'patient-1', schoolId: 'school-1' });
    expect(stored.timeline.entries[0].id).toBe('timeline-entry-1');
    first.unmount();

    renderEditor({ room: recoveryRoom, onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByRole('button', { name: 'Retry timeline' })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: 'Retry timeline' }).closest('form')!);

    await waitFor(() => expect(screen.getByText('Room, patient, and hospital timeline saved.')).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_room_id: 204, p_patient_id: 'patient-1' });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_room_id: 204, p_patient_id: 'patient-1' });
    expect(window.localStorage.getItem('nursebot:timeline-publish-recovery:v1:admin-1:school-1')).toBeNull();
  });

  it('persists a new-room recovery envelope before a pending publication and restores it after remount', async () => {
    rpc.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValueOnce({ data: { room_id: 305, patient_id: 'patient-new', timeline_entries: 1 }, error: null });
    const first = renderEditor({ room: undefined, onSave: vi.fn(), onCancel: vi.fn() });
    fireEvent.change(screen.getByLabelText('Room Number'), { target: { value: '305' } });
    fireEvent.change(screen.getByLabelText('Create new patient (optional)'), { target: { value: 'Pending Patient' } });
    fireEvent.click(screen.getByRole('button', { name: /Add entry/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Initial progress' } });
    fireEvent.change(screen.getByLabelText('Content / findings'), { target: { value: 'Pending authored history' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save Room' }).closest('form')!);

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const stored = JSON.parse(window.localStorage.getItem('nursebot:timeline-publish-recovery:v1:admin-1:school-1') ?? 'null');
    expect(stored).toMatchObject({ version: 1, actorId: 'admin-1', roomId: 305, patientId: 'patient-new', schoolId: 'school-1' });
    expect(stored.timeline.entries[0].content).toBe('Pending authored history');
    first.unmount();

    renderEditor({ room: undefined, onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByRole('button', { name: 'Retry timeline' })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('nursebot:timeline-publish-recovery:v1:admin-1:school-1') ?? 'null')).toMatchObject({
      version: 1, actorId: 'admin-1', roomId: 305, patientId: 'patient-new', schoolId: 'school-1',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
