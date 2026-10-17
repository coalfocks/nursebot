import { describe, expect, it } from 'vitest';
import { assessOrdersConfig, isAssignableOrdersConfig, preserveOrdersConfig } from './ordersConfig';

describe('orders config contract', () => {
  it('accepts the modern Case Builder package without requiring labs', () => {
    expect(assessOrdersConfig({
      admissionOrders: ['STAT CBC'],
      gatedResults: ['CBC result'],
      imaging: ['CXR'],
      futureAuthoredKey: { keep: true },
    })).toMatchObject({ valid: true, kind: 'modern' });
  });

  it('keeps a valid legacy labs array assignable', () => {
    expect(isAssignableOrdersConfig({ labs: [{ name: 'CBC', type: 'instant' }] })).toBe(true);
  });

  it('reports actionable errors for missing and malformed configs', () => {
    expect(assessOrdersConfig(null)).toMatchObject({ valid: false, kind: 'missing' });
    expect(assessOrdersConfig({ labs: 'not-an-array' })).toMatchObject({ valid: false, kind: 'invalid' });
    expect(assessOrdersConfig({ other: true })).toMatchObject({ valid: false, kind: 'invalid' });
  });

  it('does not drop modern fields or unknown authored keys during Room Editor updates', () => {
    const config = {
      admissionOrders: ['STAT CBC'],
      gatedResults: ['CBC result'],
      imaging: ['CXR'],
      unknownAuthoredField: { source: 'educator' },
    };
    expect(preserveOrdersConfig(config)).toEqual(config);
  });
});
