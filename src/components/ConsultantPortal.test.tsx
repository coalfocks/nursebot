import { describe, expect, it } from 'vitest';
import { CONSULTANT_DIRECTORY } from './ConsultantPortal';

describe('consultant directory parity', () => {
  it('keeps canonical values separate from display aliases and includes all authored services', () => {
    expect(CONSULTANT_DIRECTORY[0]).toEqual({ value: 'Attending', label: 'Attending' });
    expect(CONSULTANT_DIRECTORY.find((item) => item.value === 'Medicine')).toEqual({ value: 'Medicine', label: 'Medicine / Hospitalist' });
    expect(CONSULTANT_DIRECTORY.find((item) => item.value === 'ICU')).toEqual({ value: 'ICU', label: 'ICU / PICU' });
    for (const value of ['Neurosurgery', 'Blood Bank/Transfusion Medicine', 'Maternal-Fetal Medicine', 'Neonatology/NICU', 'Interventional Cardiology']) {
      expect(CONSULTANT_DIRECTORY.some((item) => item.value === value)).toBe(true);
    }
  });
});
