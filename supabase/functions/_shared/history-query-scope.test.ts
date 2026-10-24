import { describe, expect, it } from 'vitest';
import { optionalHistoryScope } from './history-query-scope';

describe('optional historical source query scope', () => {
  it('inventories all room audit versions when the legacy case version is unknown', () => {
    expect(optionalHistoryScope('manual_mar_packet_audit', 'assignment-1', 7, null)).toEqual({
      kind: 'room',
      room_id: 7,
      case_version: null,
      case_version_status: 'unknown_unmatched',
    });
  });

  it('keeps an explicitly known case version exact', () => {
    expect(optionalHistoryScope('manual_mar_packet_audit', 'assignment-1', 7, 'case-v1')).toEqual({
      kind: 'room',
      room_id: 7,
      case_version: 'case-v1',
      case_version_status: 'exact',
    });
  });

  it('keeps ordinary optional sources assignment-scoped', () => {
    expect(optionalHistoryScope('clinical_notes', 'assignment-1', 7, null)).toEqual({ kind: 'assignment', assignment_id: 'assignment-1' });
  });
});
