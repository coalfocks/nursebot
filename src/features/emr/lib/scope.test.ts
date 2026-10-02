import { describe, expect, it } from 'vitest';
import { resolveOverrideScope, scopeMatchesContext } from './scope';

describe('EMR scope resolution', () => {
  it('infers a scope only when explicit scope metadata is absent', () => {
    expect(resolveOverrideScope(undefined, 'assignment-1', 12)).toBe('assignment');
    expect(resolveOverrideScope(undefined, null, 12)).toBe('room');
    expect(resolveOverrideScope(undefined, null, null)).toBe('baseline');
    expect(resolveOverrideScope('baseline', 'assignment-1', 12)).toBe('baseline');
  });

  it('always keeps assignment records isolated to the exact assignment', () => {
    expect(scopeMatchesContext('assignment', 12, [12], 'assignment-1', 'assignment-1')).toBe(true);
    expect(scopeMatchesContext('assignment', 12, [12], 'assignment-2', 'assignment-1')).toBe(false);
    expect(scopeMatchesContext('assignment', 12, [12], 'assignment-1', null)).toBe(false);
  });

  it('shows room records only for the active room lineage', () => {
    expect(scopeMatchesContext('room', 12, [12, 8])).toBe(true);
    expect(scopeMatchesContext('room', 12, [9])).toBe(false);
    expect(scopeMatchesContext('room', 12, null)).toBe(false);
  });

  it('keeps baseline records available in every display context', () => {
    expect(scopeMatchesContext('baseline', null, null, null, null)).toBe(true);
  });
});
