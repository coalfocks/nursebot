import { describe, expect, it } from 'vitest';
import { normalizeSchoolInput, slugifySchoolName } from '../../supabase/functions/_shared/school-input';

describe('school input normalization', () => {
  it('trims and collapses whitespace while creating a lowercase URL slug', () => {
    expect(normalizeSchoolInput('  North   Valley College  ')).toEqual({
      ok: true,
      value: { name: 'North Valley College', slug: 'north-valley-college' },
    });
  });

  it('normalizes accents and limits generated slugs to 80 characters', () => {
    expect(slugifySchoolName('École Santé')).toBe('ecole-sante');
    expect(slugifySchoolName(`${'A'.repeat(80)} College`)).toHaveLength(80);
  });

  it('rejects empty, too short, too long, and non-sluggable names', () => {
    expect(normalizeSchoolInput('   ')).toMatchObject({ ok: false, code: 'INVALID_SCHOOL_NAME' });
    expect(normalizeSchoolInput('A')).toMatchObject({ ok: false, code: 'INVALID_SCHOOL_NAME' });
    expect(normalizeSchoolInput('a'.repeat(121))).toMatchObject({ ok: false, code: 'INVALID_SCHOOL_NAME' });
    expect(normalizeSchoolInput('東京')).toMatchObject({ ok: false, code: 'INVALID_SCHOOL_SLUG' });
  });
});
