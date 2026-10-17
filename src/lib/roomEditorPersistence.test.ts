import { describe, expect, it } from 'vitest';
import { buildContextOnlyEmrPayload, buildContextOnlyRoomUpdate, parseRoomEmrContext, roomEmrContextText } from './roomEditorPersistence';

describe('Room Editor minimal context saves', () => {
  it('updates only legacy text context', () => {
    const snapshot = { continuesFrom: null, patientResponseMode: 'responsive' };
    expect(buildContextOnlyRoomUpdate('old', 'new', snapshot, { ...snapshot })).toEqual({
      emr_context: JSON.stringify({ context: 'new' }),
    });
  });

  it('preserves an object-shaped Room00 payload and emits only emr_context', () => {
    const raw = {
      context: 'old',
      patientChat: { prompt: 'p', enabled: true, speaker: 'patient' },
      patient: { age: 19 }, event: { source: 'authored' }, orders: [{ name: 'CBC' }],
      vitals: { temperature: 37 }, evaluation: { goals: ['goal'] },
    };
    const snapshot = { continuesFrom: null, patientResponseMode: 'responsive' };
    const update = buildContextOnlyRoomUpdate(raw, 'new', snapshot, { ...snapshot });
    expect(Object.keys(update ?? {})).toEqual(['emr_context']);
    expect(JSON.parse(update!.emr_context)).toEqual({ ...raw, context: 'new' });
    expect(JSON.parse(buildContextOnlyEmrPayload(JSON.stringify(raw), 'new'))).toEqual({ ...raw, context: 'new' });
  });

  it('accepts both string and object input without treating JSON serialization as text', () => {
    const raw = JSON.stringify({ patientChat: { prompt: 'p' }, orders: { CBC: true } });
    expect(parseRoomEmrContext(raw)).toMatchObject({ patientChat: { prompt: 'p' } });
    expect(roomEmrContextText(raw)).toBe('');
    expect(buildContextOnlyRoomUpdate(raw, 'new', {}, {})).toEqual({
      emr_context: JSON.stringify({ patientChat: { prompt: 'p' }, orders: { CBC: true }, context: 'new' }),
    });
  });

  it('does not take the minimal branch when another section changed', () => {
    expect(buildContextOnlyRoomUpdate('old', 'new', { objective: 'changed' }, { objective: 'old' })).toBeNull();
  });
});
