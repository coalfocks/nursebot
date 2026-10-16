import { describe, expect, it } from 'vitest';
import { appendUncitedDeterministicActions } from './action-review';

const cbc = {
  id: 'order-cbc-1',
  title: 'Complete Blood Count with Differential',
  meta: ['Status: Completed', 'Priority: STAT'],
};

describe('deterministic action review evidence', () => {
  it('appends CBC when an unrelated action-review item has no CBC evidence ID', () => {
    const items = appendUncitedDeterministicActions(
      [{ label: 'Unrelated review', explanation: 'Different event.' }],
      [cbc],
    );

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      label: cbc.title,
      status: 'Status: Completed • Priority: STAT',
      evidence_event_ids: [cbc.id],
    });
  });

  it('does not duplicate CBC when its stable ID is already cited', () => {
    const items = appendUncitedDeterministicActions(
      [{ label: 'CBC review', evidence_event_ids: [cbc.id] }],
      [cbc],
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: 'CBC review', evidence_event_ids: [cbc.id] });
  });
});
