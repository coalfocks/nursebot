import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('test', 300));
    expect(result.current).toBe('test');
  });

  it('debounces value updates with default delay', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value),
      { initialProps: { value: 'initial' } }
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated' });
    // Value should not change immediately
    expect(result.current).toBe('initial');

    // Wait for debounce to complete
    await waitFor(
      () => {
        expect(result.current).toBe('updated');
      },
      { timeout: 1000 }
    );
  });

  it('debounces value updates with custom delay', async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'initial', delay: 200 } }
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated', delay: 200 });
    expect(result.current).toBe('initial');

    await waitFor(
      () => {
        expect(result.current).toBe('updated');
      },
      { timeout: 1000 }
    );
  });

  it('resets timer on rapid updates', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 'initial' } }
    );

    // First update
    rerender({ value: 'update1' });

    // Rapid second update before debounce completes
    await new Promise(resolve => setTimeout(resolve, 100));
    rerender({ value: 'update2' });

    // Should still show initial value
    expect(result.current).toBe('initial');

    // Should eventually show the last updated value
    await waitFor(
      () => {
        expect(result.current).toBe('update2');
      },
      { timeout: 1000 }
    );
  });

  it('works with different value types', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: 0 } }
    );

    expect(result.current).toBe(0);

    rerender({ value: 42 });
    await waitFor(
      () => {
        expect(result.current).toBe(42);
      },
      { timeout: 1000 }
    );

    rerender({ value: 100 });
    await waitFor(
      () => {
        expect(result.current).toBe(100);
      },
      { timeout: 1000 }
    );
  });

  it('handles object values', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: { key: 'initial' } } }
    );

    expect(result.current).toEqual({ key: 'initial' });

    rerender({ value: { key: 'updated' } });
    await waitFor(
      () => {
        expect(result.current).toEqual({ key: 'updated' });
      },
      { timeout: 1000 }
    );
  });

  it('handles delay change', async () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: 'initial', delay: 200 } }
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated', delay: 200 });
    await waitFor(
      () => {
        expect(result.current).toBe('updated');
      },
      { timeout: 1000 }
    );
  });
});
