import { describe, expect, it } from 'vitest';
import { buildContextOnlyEmrPayload, parseJsonObject } from './roomEditorPersistence';

describe('context-only room persistence', () => {
  it('preserves every authored nested field while replacing only context text', () => {
    const existing = {
      patientChat: { prompt: 'known history', enabled: true, speaker: 'patient' },
      patient: { heightCm: 172, weightKg: 68 },
      event: { opening: 'page' },
      orders: [{ name: 'CBC', status: 'active' }],
      vitals: { oxygen_saturation: 94 },
      evaluation: { rubric: 'v2' },
      context: 'old authored context',
    };
    const saved = parseJsonObject(buildContextOnlyEmrPayload(JSON.stringify(existing), 'new lab instructions'));
    expect(saved).toEqual({ ...existing, context: 'new lab instructions' });
  });
});
