import { describe, expect, it } from 'vitest';
import { mergePatientChatContext, normalizePatientResponseMode } from './patientChatPersistence';

describe('patient chat room persistence', () => {
  it('merges response mode without erasing nested authored fields', () => {
    const merged = mergePatientChatContext({
      context: 'case context',
      patientChat: { enabled: true, prompt: 'history', speaker: 'caregiver', disableReason: 'reason' },
    }, 'unable');
    expect(merged).toEqual({
      context: 'case context',
      patientChat: { enabled: true, prompt: 'history', speaker: 'caregiver', disableReason: 'reason', responseMode: 'unable' },
    });
  });

  it('normalizes the legacy unable-to-discuss alias on reopen', () => {
    expect(normalizePatientResponseMode('Patient unable to discuss')).toBe('unable');
  });
});
