import { describe, expect, it } from 'vitest';
import { mergePatientChatContext, normalizePatientResponseMode } from './patientChatPersistence';

describe('patient chat persistence', () => {
  it('normalizes legacy aliases', () => expect(normalizePatientResponseMode('Patient unable to discuss')).toBe('unable'));
  it('merges response mode without erasing authored nested fields', () => {
    expect(mergePatientChatContext({ patientChat: { enabled: true, prompt: 'keep', speaker: 'caregiver', disableReason: 'reason' }, other: 'keep' }, 'unable')).toEqual({ patientChat: { enabled: true, prompt: 'keep', speaker: 'caregiver', disableReason: 'reason', responseMode: 'unable' }, other: 'keep' });
  });
});
