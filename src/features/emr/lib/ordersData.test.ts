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

  it('keeps acetaminophen choices explicitly PRN', () => {
    const acetaminophen = allOrders.find((order) => order.name === 'Acetaminophen');
    expect(acetaminophen?.frequencies).toEqual(['q6h PRN', 'q8h PRN']);
  });
});
