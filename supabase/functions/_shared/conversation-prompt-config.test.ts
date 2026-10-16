import { describe, expect, it } from 'vitest';
import { resolvePinnedConversationPrompt } from './conversation-prompt-config';

describe('resolvePinnedConversationPrompt', () => {
  it('uses the pinned room field without adding a default policy', () => {
    expect(resolvePinnedConversationPrompt(
      { consultant_response_prompt: 'CONSULTANT QA RESPONSE ONLY' },
      { consultant_response_prompt: 'older prompt' },
      'consultant',
    )).toBe('older prompt');
  });

  it('falls back only to the pinned nested authored field', () => {
    expect(resolvePinnedConversationPrompt(
      { emr_context: JSON.stringify({ package: { bedside: { consultantResponsePrompt: 'nested consultant prompt' } } }) },
      null,
      'consultant',
    )).toBe('nested consultant prompt');
  });
});
