import { describe, expect, it } from 'vitest';
import { getSchoolDisplayLabel, getLearnerProgramLabel, normalizeLearnerProgram } from './programTracks';

describe('program tracks', () => {
  it('normalizes legacy or missing room/profile values to medical', () => {
    expect(normalizeLearnerProgram(null)).toBe('medical');
    expect(normalizeLearnerProgram('legacy')).toBe('medical');
    expect(normalizeLearnerProgram('nursing')).toBe('nursing');
  });

  it('keeps track labels separate from role and identity', () => {
    expect(getLearnerProgramLabel('medical')).toBe('Medical Student');
    expect(getLearnerProgramLabel('nursing')).toBe('Nursing Student');
    expect(getSchoolDisplayLabel('Creighton University', 'Creighton University SOM')).toBe('Creighton University SOM');
    expect(getSchoolDisplayLabel('Creighton University')).toBe('Creighton University');
  });
});
