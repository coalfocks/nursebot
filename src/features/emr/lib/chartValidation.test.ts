import { describe, expect, it } from 'vitest';
import { calculateAgeAtEncounter, calculateBmi, validateChartMeasurements } from './chartValidation';

describe('chart validation and encounter anchoring', () => {
  it('anchors age to the scenario encounter date, not the current calendar year', () => {
    expect(calculateAgeAtEncounter('2007-04-20', '2026-04-19')).toBe(18);
    expect(calculateAgeAtEncounter('2007-04-20', '2026-04-20')).toBe(19);
  });

  it('rejects implausible values without rewriting authored case data', () => {
    expect(validateChartMeasurements({ temperatureF: 98.7, heightCm: 175, weightKg: 70 })).toEqual([]);
    expect(validateChartMeasurements({ temperatureF: 98.7, heightCm: 1.1, weightKg: 70 })).toContain('Height must be 20–250 cm.');
    expect(validateChartMeasurements({ temperatureF: 98.7, heightCm: 175, weightKg: 0 })).toContain('Weight must be greater than 0 and at most 400 kg.');
  });

  it('does not guess BMI without an explicit height', () => {
    expect(calculateBmi(70, undefined)).toBeNull();
    expect(calculateBmi(70, 175)).toBe(22.9);
  });
});
