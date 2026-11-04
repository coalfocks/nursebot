import { describe, expect, it } from 'vitest';
import { allOrders, getInitialFrequency, labOrders, medicationOrders, normalizeOrderItem } from './ordersData';

describe('medication catalog', () => {
  it('includes the required searchable products and aliases', () => {
    const buspirone = medicationOrders.find((order) => order.id === 'med-buspirone-tablet');
    const clozapine = medicationOrders.find((order) => order.id === 'med-clozapine-tablet');
    const prazosin = medicationOrders.find((order) => order.id === 'med-prazosin-capsule');
    const divalproexEr = medicationOrders.find((order) => order.id === 'med-divalproex-er-tablet');

    expect(buspirone?.aliases).toContain('Buspar');
    expect(buspirone?.routes).toContain('PO');
    expect(clozapine?.productIdentifier).toBe('clozapine-100mg-tablet');
    expect(prazosin?.formulation).toBe('Immediate-release capsule');
    expect(divalproexEr?.formulation).toBe('Extended-release tablet');
    expect(divalproexEr?.name).not.toMatch(/immediate-release|valproate(?!.*divalproex)/i);
  });

  it('keeps one-time and continuous fluid schedules usable', () => {
    expect(allOrders.find((order) => order.name === 'Lactated Ringers Bolus')?.frequencies).toContain('Once');
    expect(allOrders.find((order) => order.name === 'Lactated Ringers Maintenance')?.frequencies).toContain('Continuous');
    expect(allOrders.find((order) => order.name === 'Lactated Ringer’s')?.frequencies).toEqual(
      expect.arrayContaining(['Once', 'Continuous']),
    );
  });

  it('collapses equivalent CBC catalog labels without deleting historical IDs', () => {
    const cbcOrders = labOrders.filter((order) => /cbc|complete blood count/i.test(order.name));
    expect(cbcOrders).toHaveLength(1);
    expect(cbcOrders[0]?.aliases).toEqual(expect.arrayContaining(['CBC with Differential', 'CBC']));
    expect(cbcOrders[0]?.frequencies).toContain('Once');
  });

  it('offers canonical Once for every category while preserving explicit schedules', () => {
    expect(normalizeOrderItem({ id: 'other', name: 'Consult', category: 'Consult', priorities: ['Routine'] }).frequencies)
      .toEqual(['Once']);
    expect(normalizeOrderItem({
      id: 'prn', name: 'Medication', category: 'Medication', priorities: ['Routine'], frequencies: ['q6h PRN'],
    }).frequencies).toEqual(['Once', 'q6h PRN']);
    expect(normalizeOrderItem({
      id: 'weekly', name: 'Weekly', category: 'Lab', priorities: ['Routine'], frequencies: ['Weekly'],
    }).frequencies).toEqual(['Once', 'Weekly']);
    expect(getInitialFrequency({ id: 'missing', name: 'Other', category: 'General', priorities: ['Routine'] })).toBe('Once');
    expect(getInitialFrequency({
      id: 'explicit', name: 'PRN', category: 'Medication', priorities: ['Routine'], frequencies: ['q6h PRN'],
    })).toBe('q6h PRN');
  });
});
