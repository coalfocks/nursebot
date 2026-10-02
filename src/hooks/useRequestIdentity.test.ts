import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRequestIdentity } from './useRequestIdentity';

describe('useRequestIdentity', () => {
  it('rejects delayed responses after A→B→A switches', () => {
    const { result, rerender } = renderHook(({ key }) => useRequestIdentity(key), {
      initialProps: { key: 'patient-a:room-a:assignment-a' },
    });

    const firstA = result.current.capture();
    rerender({ key: 'patient-b:room-b:assignment-b' });
    expect(result.current.isCurrent(firstA)).toBe(false);

    const b = result.current.capture();
    expect(result.current.isCurrent(b)).toBe(true);

    rerender({ key: 'patient-a:room-a:assignment-a' });
    expect(result.current.isCurrent(firstA)).toBe(false);
    expect(result.current.isCurrent(b)).toBe(false);
    expect(result.current.isCurrent(result.current.capture())).toBe(true);
  });
});
