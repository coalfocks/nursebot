import { useState } from 'react';

/** Keep identity, not a stale copy of a persisted feedback row. */
export function useAssignmentSelection<T extends { id: string }>(rows: T[]): [T | null, (row: T | null) => void] {
  const [id, setId] = useState<string | null>(null);
  return [rows.find(row => row.id === id) ?? null, row => setId(row?.id ?? null)];
}
