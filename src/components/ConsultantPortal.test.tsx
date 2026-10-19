import { describe, expect, it } from 'vitest';
import { CONSULTANT_DIRECTORY, filterConsultantMessages, getConsultantThreadKey } from './ConsultantPortal';

describe('consultant directory parity', () => {
  it('keeps canonical values separate from display aliases and includes all authored services', () => {
    expect(CONSULTANT_DIRECTORY[0]).toEqual({ value: 'Attending', label: 'Attending', audiences: ['adult', 'pediatric'] });
    expect(CONSULTANT_DIRECTORY.find((item) => item.value === 'Medicine')).toEqual({ value: 'Medicine', label: 'Medicine / Hospitalist', audiences: ['adult'] });
    expect(CONSULTANT_DIRECTORY.find((item) => item.value === 'ICU')).toEqual({ value: 'ICU', label: 'ICU / PICU', audiences: ['adult', 'pediatric'] });
    for (const value of ['Neurosurgery', 'Blood Bank/Transfusion Medicine', 'Maternal-Fetal Medicine', 'Neonatology/NICU', 'Interventional Cardiology']) {
      expect(CONSULTANT_DIRECTORY.some((item) => item.value === value)).toBe(true);
    }
  });

  it('keeps drafts and transcripts isolated by population and canonical service', () => {
    expect(getConsultantThreadKey('adult', 'Medicine')).not.toBe(getConsultantThreadKey('pediatric', 'Medicine'));
    expect(filterConsultantMessages([
      { role: 'student', content: 'adult', audience: 'adult', specialty: 'Medicine' },
      { role: 'consultant', content: 'pediatric', audience: 'pediatric', specialty: 'Medicine' },
      { role: 'student', content: 'other service', audience: 'adult', specialty: 'Cardiology' },
    ], 'adult', 'Medicine')).toEqual([{ role: 'student', content: 'adult', audience: 'adult', specialty: 'Medicine' }]);
  });
});
