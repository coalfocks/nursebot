import { describe, expect, it } from 'vitest';
import { buildConversationPromptPatch, normalizeAuthoredConversationPrompt, resolveAuthoredConversationPrompt } from './conversationPrompts';

describe('authored conversation prompts', () => {
  it('uses one exact trimmed value and no generated fallback', () => {
    expect(normalizeAuthoredConversationPrompt('  Only this instruction.  ')).toBe('Only this instruction.');
    expect(normalizeAuthoredConversationPrompt('   ')).toBeNull();
    expect(resolveAuthoredConversationPrompt({ patient_conversation_prompt: null }, 'patient')).toBe('');
  });

  it('builds independent room patches without touching the other channel', () => {
    expect(buildConversationPromptPatch('patient', 'patient source')).toEqual({ patient_conversation_prompt: 'patient source' });
    expect(buildConversationPromptPatch('consultant', 'consultant source')).toEqual({ consultant_response_prompt: 'consultant source' });
  });
});
