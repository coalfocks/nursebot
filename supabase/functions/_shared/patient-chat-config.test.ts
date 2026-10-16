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

  it('uses a legacy prompt-only unable declaration for a pinned dedicated prompt', () => {
    expect(resolvePatientChatConfig({
      patient_conversation_prompt: 'Patient unable to respond; do not provide a conversational answer.',
      patient_conversation_enabled: true,
      emr_context: JSON.stringify({ patientChat: { enabled: true } }),
    })).toMatchObject({ enabled: true, responseMode: 'unable' });
  });

  it('lets an explicit responsive mode override a legacy unable declaration', () => {
    expect(resolvePatientChatConfig({
      patient_conversation_prompt: 'Patient unable to respond unless the mode is explicitly responsive.',
      patient_conversation_enabled: true,
      patient_response_mode: 'responsive',
    }).responseMode).toBe('responsive');
  });

  it('does not infer a legacy alias from a versioned structured prompt', () => {
    expect(resolvePatientChatConfig({
      patient_conversation_prompt: 'The patient is unable to respond to this question, but remains responsive to simple comfort checks.',
      patient_conversation_enabled: true,
      emr_context: JSON.stringify({ patientChat: { configVersion: 2 } }),
    }).responseMode).toBe('responsive');
  });

  it('preserves disabled and caregiver configuration', () => {
    expect(resolvePatientChatConfig({
      patient_conversation_prompt: 'Caregiver behavior',
      patient_conversation_enabled: false,
      patient_speaker_type: 'caregiver',
    })).toMatchObject({ enabled: false, speaker: 'caregiver' });
  });
});
