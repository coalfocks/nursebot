import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useAssignmentSelection } from './useAssignmentSelection';
it('open review immediately follows persisted rerun data without selecting another row', () => {
  const old = { id: 'synthetic', feedback_status: 'completed', communication_score: 1, feedback_generated_at: 'July' };
  const { result, rerender } = renderHook(({ rows }) => useAssignmentSelection(rows), { initialProps: { rows: [old] } });
  act(() => result.current[1](old));
  const saved = { ...old, communication_score: 5, feedback_generated_at: 'November' };
  rerender({ rows: [saved] });
  expect(result.current[0]).toBe(saved);
  rerender({ rows: [{ ...saved, feedback_status: 'failed' }] });
  expect(result.current[0]?.feedback_status).toBe('failed');
  expect(result.current[0]?.communication_score).toBe(5);
  rerender({ rows: [] });
  expect(result.current[0]).toBeNull();
});
