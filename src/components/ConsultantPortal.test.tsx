import { describe, expect, it } from 'vitest';
import { CONSULTANT_DIRECTORY, searchConsultants } from '../lib/consultantDirectory';

describe('consultant directory routing', () => {
  it('has stable adult/pediatric IDs and starts with no implicit selection', () => {
    expect(CONSULTANT_DIRECTORY[0]).toMatchObject({ id: 'adult-attending', audience: 'adult' });
    expect(CONSULTANT_DIRECTORY.some((service) => service.id === 'pediatric-rheumatology')).toBe(true);
    expect(CONSULTANT_DIRECTORY.some((service) => service.id === 'adult-colorectal-surgery')).toBe(true);
  });

  it('searches labels and aliases without mixing audiences', () => {
    expect(searchConsultants('pediatric', 'GI').map((service) => service.id)).toContain('pediatric-gastroenterology');
    expect(searchConsultants('adult', 'peds')).toHaveLength(0);
    expect(searchConsultants('', 'cardio').map((service) => service.id)).toEqual(expect.arrayContaining(['adult-cardiology', 'pediatric-cardiology']));
  });
});
