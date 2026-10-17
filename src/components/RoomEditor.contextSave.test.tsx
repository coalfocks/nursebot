import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoomEditor from './RoomEditor';

const { updateRoom, rpc } = vi.hoisted(() => ({ updateRoom: vi.fn(), rpc: vi.fn() }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.order = vi.fn(async () => ({ data: table === 'schools' || table === 'specialties' ? [] : [], error: null }));
      builder.or = vi.fn(() => builder);
      builder.update = vi.fn((payload: unknown) => {
        updateRoom(payload);
        return { eq: vi.fn(async () => ({ error: null })) };
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
  useSchools: () => ({ schools: [{ id: 'school-1', name: 'Synthetic School', display_name: 'Synthetic School' }] }),
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
  beforeEach(() => { updateRoom.mockReset(); rpc.mockReset(); });

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
});
