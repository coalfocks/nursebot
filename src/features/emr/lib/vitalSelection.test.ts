import { describe, expect, it } from 'vitest';
import { selectLatestVitals } from './vitalSelection';

const vital = (id: string, timestamp: string, extra: Partial<{ assignmentId: string; overrideScope: 'baseline' | 'assignment'; oxygenSaturation: number }> = {}) => ({
  id,
  patientId: 'synthetic',
  timestamp,
  temperature: 98,
  ...extra,
});

describe('selectLatestVitals', () => {
  it('prefers the active assignment over newer baseline history', () => {
    const selected = selectLatestVitals([
      vital('baseline', '2026-10-16T18:10:00Z', { oxygenSaturation: 95 }),
      vital('attempt', '2026-10-16T17:00:00Z', { assignmentId: 'a', overrideScope: 'assignment', oxygenSaturation: 90 }),
    ], 'a');
    expect(selected?.id).toBe('attempt');
    expect(selected?.oxygenSaturation).toBe(90);
  });
});
