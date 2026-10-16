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

  it.each([
    'If later speech becomes impossible, return Patient unable to respond.',
    'Do not pretend to be unresponsive.',
    'The phrase "Patient unable to respond." is not an instruction for this interview.',
  ])('does not classify conditional, negated, or quoted mentions as unable: %s', (prompt) => {
    expect(resolvePatientChatConfig({ patient_conversation_prompt: prompt, patient_conversation_enabled: true }).responseMode).toBe('responsive');
  });

  it('lets the anchored authored marker override stale nested mode', () => {
    expect(resolvePatientChatConfig({
      patient_conversation_prompt: 'INTERVIEW_STATUS: responsive\nIf later speech becomes impossible, remain calm.',
      patient_conversation_enabled: true,
      emr_context: JSON.stringify({ patientChat: { responseMode: 'unable' } }),
    }).responseMode).toBe('responsive');
    expect(resolvePatientChatConfig({
      patient_conversation_prompt: 'INTERVIEW_STATUS: unavailable\nDo not add any other response.',
      patient_conversation_enabled: true,
      emr_context: JSON.stringify({ patientChat: { responseMode: 'responsive' } }),
    }).responseMode).toBe('unable');
  });

  it('keeps the exact legacy305 declaration deterministic', () => {
    expect(resolvePatientChatConfig({ patient_conversation_prompt: 'Patient unable to discuss', patient_conversation_enabled: true }).responseMode).toBe('unable');
    expect(resolvePatientChatConfig({ patient_conversation_prompt: 'Patient unable to discuss symptoms unless asked', patient_conversation_enabled: true }).responseMode).toBe('responsive');
  });
});
