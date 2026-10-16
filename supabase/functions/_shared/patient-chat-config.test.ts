import { describe, expect, it } from 'vitest';
import { resolvePatientChatConfig } from './patient-chat-config';

describe('resolvePatientChatConfig', () => {
  it('honors explicit unable mode with a dedicated prompt', () => {
    const config = resolvePatientChatConfig({ patient_conversation_prompt: 'Dedicated prompt', patient_conversation_enabled: true, emr_context: JSON.stringify({ patientChat: { responseMode: 'unable' } }) });
    expect(config).toMatchObject({ enabled: true, prompt: 'Dedicated prompt', responseMode: 'unable' });
  });

  it('uses the dedicated prompt for responsive mode', () => {
    expect(resolvePatientChatConfig({ patient_conversation_prompt: 'Responsive prompt', patient_conversation_enabled: true, emr_context: JSON.stringify({ patientChat: { responseMode: 'responsive' } }) })).toMatchObject({ prompt: 'Responsive prompt', responseMode: 'responsive' });
  });

  it('normalizes legacy unable-to-discuss and preserves disabled caregiver state', () => {
    expect(resolvePatientChatConfig({ emr_context: JSON.stringify({ patientChat: { prompt: 'Legacy', enabled: true, responseMode: 'Patient unable to discuss' } }) }).responseMode).toBe('unable');
    expect(resolvePatientChatConfig({ patient_conversation_prompt: 'Caregiver', patient_conversation_enabled: false, patient_speaker_type: 'caregiver' })).toMatchObject({ enabled: false, speaker: 'caregiver' });
  });

  it('resolves a pinned nested mode without the optional dedicated mode column', () => {
    const config = resolvePatientChatConfig({
      patient_conversation_prompt: 'Return exactly the authored response.',
      patient_conversation_enabled: true,
      emr_context: JSON.stringify({ patientChat: { enabled: true, responseMode: 'unable', prompt: 'legacy' } }),
    });
    expect(config).toMatchObject({ enabled: true, responseMode: 'unable', prompt: 'Return exactly the authored response.' });
  });
});
