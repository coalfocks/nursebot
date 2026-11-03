import { describe, expect, it } from 'vitest';
import { resolveLabTemplates } from './aiLabGenerator';
import { instantLabs } from './labCatalog';
import { isInstantLab } from './labGeneration';

describe('Instant Lab contract', () => {
  it('classifies every catalogued Instant Lab as result-producing', () => {
    expect(instantLabs.every((name) => isInstantLab(name))).toBe(true);
  });

  it('uses the most specific panel mapping', () => {
    expect(resolveLabTemplates('Complete Blood Count with Differential').map((test) => test.testName))
      .toEqual(expect.arrayContaining(['Neutrophils %', 'Lymphocytes %']));
  });

  it('does not substitute an unrelated panel for an unmapped Instant Lab', () => {
    const templates = resolveLabTemplates('Urine Legionella Antigen');
    expect(templates).toEqual([expect.objectContaining({
      testName: 'Urine Legionella Antigen',
      referenceRange: 'See interpretation',
    })]);
  });
});
