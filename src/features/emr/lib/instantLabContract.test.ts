import { describe, expect, it } from 'vitest';
import { applyAuthoredLabValues, resolveLabTemplates, validateGeneratedLabResults } from './aiLabGenerator';
import { instantLabs } from './labCatalog';
import { getLabType } from './labOrderDecision';

describe('instant lab result contract', () => {
  it('classifies every catalogued Instant Lab as result-producing', () => {
    expect(instantLabs.every((name) => getLabType(name) === 'instant')).toBe(true);
  });

  it('accepts safe clinical aliases and rewrites them to canonical analytes', () => {
    const templates = resolveLabTemplates('Basic Metabolic Panel (BMP)');
    const validated = validateGeneratedLabResults(
      templates.map((template) => ({
        testName: ({
          Sodium: 'Na',
          Potassium: 'K',
          Chloride: 'Cl',
          'CO2 (Bicarbonate)': 'CO2',
          BUN: 'Blood Urea Nitrogen',
          Creatinine: 'Creat',
          Glucose: 'Blood Glucose',
          Calcium: 'Ca',
        } as Record<string, string>)[template.testName] ?? template.testName,
        value: 1,
        unit: 'model-unit',
        referenceRange: template.referenceRange,
      })),
      templates,
    );

    expect(validated.map((result) => result.testName)).toEqual(templates.map((template) => template.testName));
    expect(validated.every((result, index) => result.unit === templates[index]?.unit)).toBe(true);
  });

  it('keeps unsupported Instant Lab orders result-producing without inventing a panel', () => {
    const templates = resolveLabTemplates('Urine Legionella Antigen');
    expect(templates).toHaveLength(1);
    expect(templates[0]?.testName).toBe('Urine Legionella Antigen');
    expect(
      validateGeneratedLabResults(
        [{ testName: 'Urine Legionella Antigen', value: 'Not detected', referenceRange: 'See interpretation' }],
        templates,
      ),
    ).toHaveLength(1);
  });

  it('keeps the complete CBC panel and overlays explicit authored case values', () => {
    const templates = resolveLabTemplates('CBC');
    const merged = applyAuthoredLabValues(
      [{ testName: 'WBC', value: 4.1, referenceRange: '4-11' }],
      templates,
      JSON.stringify({ admission: { labs: [{ labName: 'Hemoglobin', value: 13.7 }] } }),
    );
    const validated = validateGeneratedLabResults(
      merged.map((result, index) => ({
        ...result,
        value: result.value ?? index + 1,
        referenceRange: result.referenceRange ?? templates[index]?.referenceRange,
      })),
      templates,
    );
    expect(validated).toHaveLength(templates.length);
    expect(validated.find((lab) => lab.testName === 'Hemoglobin')?.value).toBe(13.7);
  });
});
