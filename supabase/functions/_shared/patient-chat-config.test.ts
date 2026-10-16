import { describe, expect, it } from 'vitest';
import { resolvePatientChatConfig } from './patient-chat-config';

describe('resolvePatientChatConfig', () => {
  it('uses explicit unable mode with a dedicated prompt without an LLM path', () => {
    const config = resolvePatientChatConfig({
      patient_conversation_prompt: 'Dedicated patient behavior',
      patient_conversation_enabled: true,
      emr_context: JSON.stringify({ patientChat: { responseMode: 'unable' } }),
    });
    expect(config).toMatchObject({ enabled: true, prompt: 'Dedicated patient behavior', responseMode: 'unable' });
  });

  it('uses the authored dedicated prompt on the responsive path', () => {
    expect(resolvePatientChatConfig({
      patient_conversation_prompt: 'Dedicated responsive behavior',
      patient_conversation_enabled: true,
      emr_context: JSON.stringify({ patientChat: { responseMode: 'responsive' } }),
    })).toMatchObject({ prompt: 'Dedicated responsive behavior', responseMode: 'responsive' });
  });

  it('normalizes the legacy unable-to-discuss alias', () => {
    expect(resolvePatientChatConfig({
      emr_context: JSON.stringify({ patientChat: { prompt: 'Legacy behavior', enabled: true, responseMode: 'unable to discuss' } }),
    }).responseMode).toBe('unable');
  });

  it('preserves disabled and caregiver configuration', () => {
    expect(resolvePatientChatConfig({
      patient_conversation_prompt: 'Caregiver behavior',
      patient_conversation_enabled: false,
      patient_speaker_type: 'caregiver',
    })).toMatchObject({ enabled: false, speaker: 'caregiver' });
  });
});
