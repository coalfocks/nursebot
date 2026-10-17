import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoomEditor from './RoomEditor';

const { updateRoom, rpc, availabilityState } = vi.hoisted(() => ({
  updateRoom: vi.fn(),
  rpc: vi.fn(),
  availabilityState: {
    response: { data: { available_school_ids: ['school-1'], updated_at: '2026-10-17T00:00:00.000Z' }, error: null } as { data: unknown; error: unknown },
    pending: null as Promise<unknown> | null,
  },
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.order = vi.fn(async () => ({ data: table === 'schools' || table === 'specialties' ? [] : [], error: null }));
      builder.or = vi.fn(() => builder);
      builder.update = vi.fn((payload: unknown) => {
        updateRoom(payload);
        const query = {
          eq: vi.fn(() => query),
          is: vi.fn(() => query),
          maybeSingle: vi.fn(async () => availabilityState.pending ?? availabilityState.response),
          select: vi.fn(() => query),
        };
        return query;
      });
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
  is_active: true, pdf_url: null, available_school_ids: ['school-1'], continues_from: null,
  patient_id: null, initial_vitals: null, created_at: null, updated_at: null,
  encounter_type: 'inpatient', hospital_stay_days: 1, hospital_timeline: { entries: [] },
} as never;

describe('RoomEditor EMR context control', () => {
  beforeEach(() => {
    updateRoom.mockReset();
    rpc.mockReset();
    availabilityState.pending = null;
    availabilityState.response = { data: { available_school_ids: ['school-1'], updated_at: '2026-10-17T00:00:00.000Z' }, error: null };
  });

  it('bypasses native required Style and incomplete timeline validation', async () => {
    render(<RoomEditor room={room} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('EHR Context'), { target: { value: 'new lab instructions' } });
    fireEvent.click(screen.getByTestId('save-emr-context'));

    await waitFor(() => expect(updateRoom).toHaveBeenCalledTimes(1));
    expect(updateRoom).toHaveBeenCalledWith({ emr_context: expect.stringContaining('new lab instructions') });
    expect(updateRoom.mock.calls[0][0]).not.toHaveProperty('style');
    expect(updateRoom.mock.calls[0][0]).not.toHaveProperty('hospital_timeline');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('saves only school availability with blank Style and invalid unchanged timeline', async () => {
    const onRoomPatch = vi.fn();
    availabilityState.response = { data: { available_school_ids: [], updated_at: '2026-10-17T00:00:00.000Z' }, error: null };
    render(<RoomEditor room={room} onSave={vi.fn()} onCancel={vi.fn()} onRoomPatch={onRoomPatch} />);
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

  it('keeps the draft and reports a conflict when the room revision is stale', async () => {
    const onRoomPatch = vi.fn();
    availabilityState.response = { data: null, error: null };
    render(<RoomEditor room={room} onSave={vi.fn()} onCancel={vi.fn()} onRoomPatch={onRoomPatch} />);
    fireEvent.click(screen.getByTestId('save-school-availability'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Save conflict'));
    expect(onRoomPatch).not.toHaveBeenCalled();
  });

  it('allows only one in-flight availability save', async () => {
    let resolvePending!: (value: unknown) => void;
    availabilityState.pending = new Promise((resolve) => { resolvePending = resolve; });
    render(<RoomEditor room={room} onSave={vi.fn()} onCancel={vi.fn()} />);
    const button = screen.getByTestId('save-school-availability');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(updateRoom).toHaveBeenCalledTimes(1);

    resolvePending({ data: { available_school_ids: ['school-1'], updated_at: '2026-10-17T00:00:01.000Z' }, error: null });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved and read back'));
  });
});
