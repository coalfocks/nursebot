import { describe, expect, it } from 'vitest';
import { normalizeImagingContrast } from './imagingContrast';

describe('normalizeImagingContrast', () => {
  it('uses structured contrast as canonical and flags conflicting legacy labels', () => {
    const result = normalizeImagingContrast({
      contrast: 'without',
      orderName: 'CT (With contrast)',
      report: 'CT without intravenous contrast.',
    });
    expect(result.contrast).toBe('without');
    expect(result.displayOrderName).toBe('CT (Without contrast)');
    expect(result.warning).toBeTruthy();
  });

  it('derives a missing structured value without mutating source text', () => {
    const study = { contrast: null as const, orderName: 'CT chest (Without contrast)', report: null };
    const result = normalizeImagingContrast(study);
    expect(result.contrast).toBe('without');
    expect(study.orderName).toBe('CT chest (Without contrast)');
  });
});
