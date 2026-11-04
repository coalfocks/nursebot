import { describe, expect, it } from 'vitest';
import {
  buildContextOnlyEmrPayload,
  buildContextOnlyRoomUpdate,
  isContextOnlyEdit,
  parseRoomEmrContext,
  roomEmrContextText,
} from './roomEditorPersistence';

describe('Room Editor context-only persistence', () => {
  it('preserves a legacy text context while replacing only the text', () => {
    expect(buildContextOnlyEmrPayload('old lab instructions', 'new lab instructions')).toBe(
      JSON.stringify({ context: 'new lab instructions' }),
    );
  });

  it('preserves every nested Room00 field when the raw value is already an object', () => {
    const room00 = {
      context: 'old',
      patientChat: { prompt: 'patient prompt', enabled: true, speaker: 'patient' },
      patient: { ageAtEncounter: 19 },
      event: { source: 'authored' },
      orders: [{ name: 'CBC' }],
      vitals: { temperature: 37 },
      evaluation: { goals: ['recognize infiltration'] },
    };
    const saved = JSON.parse(buildContextOnlyEmrPayload(room00, 'new')) as typeof room00;
    expect(saved).toEqual({ ...room00, context: 'new' });
  });

  it('accepts the JSON-string Room00 shape and keeps nested keys', () => {
    const raw = JSON.stringify({ patientChat: { prompt: 'p', enabled: true }, orders: { CBC: true } });
    expect(parseRoomEmrContext(raw)).toEqual({ patientChat: { prompt: 'p', enabled: true }, orders: { CBC: true } });
    expect(roomEmrContextText(raw)).toBe('');
    expect(JSON.parse(buildContextOnlyEmrPayload(raw, 'ordered lab instructions'))).toMatchObject({
      patientChat: { prompt: 'p', enabled: true },
      orders: { CBC: true },
      context: 'ordered lab instructions',
    });
  });

  it('uses structural equality rather than object insertion order for the submit branch', () => {
    const left = { continuesFrom: null, patientResponseMode: 'responsive', consultantResponsePrompt: 'c' };
    const right = { patientResponseMode: 'responsive', consultantResponsePrompt: 'c', continuesFrom: null };
    expect(isContextOnlyEdit(left, right, true)).toBe(true);
    expect(isContextOnlyEdit(left, right, false)).toBe(false);
    expect(isContextOnlyEdit({ ...left, objective: 'changed' }, right, true)).toBe(false);
  });

  it('emits only emr_context for the legacy-text submit branch', () => {
    const snapshot = { continuesFrom: null, patientResponseMode: 'responsive' };
    expect(buildContextOnlyRoomUpdate('old', 'new', snapshot, { ...snapshot })).toEqual({
      emr_context: JSON.stringify({ context: 'new' }),
    });
  });

  it('emits only emr_context for the generated Room00-shaped submit branch', () => {
    const raw = {
      patientChat: { prompt: 'p', enabled: true, speaker: 'patient' },
      patient: { age: 19 },
      event: { source: 'authored' },
      orders: [{ name: 'CBC' }],
      vitals: { temperature: 37 },
      evaluation: { goals: ['goal'] },
    };
    const snapshot = { continuesFrom: null, patientResponseMode: 'responsive' };
    const update = buildContextOnlyRoomUpdate(raw, 'ordered lab instructions', snapshot, { ...snapshot });
    expect(update && Object.keys(update)).toEqual(['emr_context']);
    expect(JSON.parse(update!.emr_context)).toMatchObject({
      patientChat: raw.patientChat,
      patient: raw.patient,
      event: raw.event,
      orders: raw.orders,
      vitals: raw.vitals,
      evaluation: raw.evaluation,
      context: 'ordered lab instructions',
    });
  });
});
