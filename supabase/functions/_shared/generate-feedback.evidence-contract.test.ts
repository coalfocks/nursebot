import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('generate-feedback evidence assembly contract', () => {
  it('fetches patient/consultant channels and keeps completion hints contextual', () => {
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/generate-feedback/index.ts'), 'utf8');
    expect(source).toContain("from('patient_chat_messages')");
    expect(source).toContain("from('consultant_chat_messages')");
    expect(source).toContain('patientMessages: (patientMessagesRes.data ?? [])');
    expect(source).toContain('consultantMessages: (consultantMessagesRes.data ?? [])');
    expect(source).toContain('COMPLETION HINTS VIEWED (context only; never evidence IDs, CAUs, or points by themselves)');
    expect(source).toContain('completion_hints_viewed: viewedCompletionHints.map');
    expect(source).toContain('const sourceEventIds = scoredEntries.map((entry) => entry.id)');
  });
});
