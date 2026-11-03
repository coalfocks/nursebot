import { describe, expect, it } from 'vitest';
import { allOrders } from './ordersData';
import { resolveLabTemplates } from './aiLabGenerator';

describe('clinical order catalog', () => {
  it('offers explicit one-time choices for CBC with differential', () => {
    const cbc = allOrders.find((order) => /complete blood count with differential/i.test(order.name));
    expect(cbc?.frequencies).toEqual(expect.arrayContaining(['Once', 'Now']));
  });

  it('generates the complete CBC differential panel', () => {
    const expected = [
      'White Blood Cell Count',
      'Neutrophils %',
      'Lymphocytes %',
      'Hemoglobin',
      'Hematocrit',
      'Platelets',
    ];
    expect(resolveLabTemplates('CBC with Differential').map((template) => template.testName)).toEqual(expected);
    expect(resolveLabTemplates('Complete Blood Count with Differential').map((template) => template.testName)).toEqual(expected);
  });

  it.each([
    ['Basic Metabolic Panel', 8],
    ['Basic Metabolic Panel (BMP)', 8],
    ['BMP', 8],
    ['Comprehensive Metabolic Panel', 13],
    ['Comprehensive Metabolic Panel (CMP)', 13],
    ['CMP', 13],
  ])('resolves the complete %s panel for generation', (orderName, expectedCount) => {
    expect(resolveLabTemplates(orderName)).toHaveLength(expectedCount);
  });

  it('keeps acetaminophen choices explicitly PRN', () => {
    const acetaminophen = allOrders.find((order) => order.name === 'Acetaminophen');
    expect(acetaminophen?.frequencies).toEqual(['Once', 'q6h PRN', 'q8h PRN']);
  });

  it('offers Once on every order without dropping existing PRN schedules', () => {
    expect(allOrders.every((order) => order.frequencies?.includes('Once'))).toBe(true);
    const morphine = allOrders.find((order) => order.name === 'Morphine');
    expect(morphine?.frequencies).toEqual(expect.arrayContaining(['Once', 'q4h PRN', 'q6h PRN', 'q2h PRN']));
  });
});
