import { describe, expect, it } from 'vitest';
import { CONSULTANT_SPECIALTIES } from './ConsultantPortal';

describe('consultant learner selection', () => {
  it('puts Attending first without silently selecting a specialty', () => {
    expect(CONSULTANT_SPECIALTIES[0]).toBe('Attending');
    expect(CONSULTANT_SPECIALTIES).toContain('Orthopedics');
    expect(CONSULTANT_SPECIALTIES).toContain('ENT');
    expect(CONSULTANT_SPECIALTIES).toContain('Pediatric Hepatology');
  });
});
