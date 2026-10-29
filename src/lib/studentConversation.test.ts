import { describe, expect, it } from 'vitest';
import { mapStudentConversationMessages, parseAuthoredPatientConversation } from './studentConversation';

describe('student conversation compatibility', () => {
  it('prefers authored room fields over legacy context', () => {
    expect(parseAuthoredPatientConversation(JSON.stringify({ patientChat: { enabled: false, prompt: 'legacy' } }), {
      enabled: true,
      prompt: 'authored',
      reason: 'authored reason',
      speaker: 'caregiver',
    })).toEqual({ enabled: true, prompt: 'authored', reason: 'authored reason', speaker: 'caregiver' });
  });

  it('maps persisted patient transcript roles without inventing content', () => {
    expect(mapStudentConversationMessages([
      { role: 'student', content: 'What hurts?' },
      { role: 'assistant', content: 'My chest.' },
      { role: 'patient', content: '   ' },
    ])).toEqual([
      { role: 'student', content: 'What hurts?' },
      { role: 'patient', content: 'My chest.' },
    ]);
  });
});
