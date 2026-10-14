import { describe, expect, it } from 'vitest';
import { decideLabMaterialization, getLabType } from './labOrderDecision';

describe('lab order materialization', () => {
  it('recognizes instant panels regardless of priority', () => {
    expect(getLabType('Basic Metabolic Panel')).toBe('instant');
    expect(getLabType('CBC')).toBe('instant');
    expect(getLabType('Comprehensive Metabolic Panel')).toBe('instant');
    expect(decideLabMaterialization({ category: 'Lab', orderName: 'Basic Metabolic Panel', existingResultCount: 0, expectedResultCount: 8 }))
      .toBe('materialize');
  });

  it('leaves pending labs pending and does not repeat linked results', () => {
    expect(decideLabMaterialization({ category: 'Lab', orderName: 'Blood Culture x2 (Peripheral)', existingResultCount: 0, expectedResultCount: 1 }))
      .toBe('pending');
    expect(decideLabMaterialization({ category: 'Lab', orderName: 'CBC', existingResultCount: 6, expectedResultCount: 6 }))
      .toBe('already_satisfied');
  });
});
