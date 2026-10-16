import { describe, expect, it } from 'vitest';
import { resolvePatientChatConfig } from './patient-chat-config';

describe('schema-compatible patient chat configuration', () => {
  it('resolves an unable legacy declaration from nested pinned JSON without a dedicated column', () => {
    const config = resolvePatientChatConfig({
      emr_context: JSON.stringify({ patientChat: {
        prompt: 'The patient is noncommunicative and cannot respond.',
        enabled: true,
      } }),
      patient_conversation_prompt: 'The patient is noncommunicative and cannot respond.',
      patient_conversation_enabled: true,
    });
    expect(config.responseMode).toBe('unable');
    expect(config.enabled).toBe(true);
  });

  it('lets an explicit structured responsive mode override legacy wording', () => {
    expect(resolvePatientChatConfig({
      emr_context: JSON.stringify({ patientChat: { prompt: 'Legacy unable to discuss text', enabled: true, responseMode: 'responsive' } }),
      patient_conversation_prompt: 'Legacy unable to discuss text',
      patient_conversation_enabled: true,
    }).responseMode).toBe('responsive');
  });
});
