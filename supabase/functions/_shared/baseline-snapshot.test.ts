import { describe, expect, it } from 'vitest';
import { readBaselineSnapshot, renderBaselineReference } from './baseline-snapshot.ts';

const captured = {
  captured_at: '2026-05-06T16:50:00Z',
  baseline_version: 'room-203-baseline-v10',
  medications: [{ name: 'Dexamethasone', dose: '6 mg', route: 'PO', frequency: 'daily', indication: 'COVID pneumonia', status: 'active', kind: 'scheduled' }],
  active_orders: [{ name: 'Acetaminophen', dose: '650 mg', route: 'PO', frequency: 'q6h PRN', indication: 'fever', status: 'active', kind: 'prn' }],
};

describe('historical baseline snapshot', () => {
  it('reports attempts without a stored snapshot as unavailable, never as an empty list', () => {
    const result = readBaselineSnapshot(null);
    expect(result.status).toBe('unavailable');
    expect(renderBaselineReference(result)).toEqual([expect.stringContaining('unavailable')]);
  });

  it('reads a captured snapshot with its capture time and version', () => {
    const result = readBaselineSnapshot(captured);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') return;
    expect(result.baseline_version).toBe('room-203-baseline-v10');
    expect(result.medications[0]).toMatchObject({ name: 'Dexamethasone', status: 'active', kind: 'scheduled' });
  });

  it('marks a malformed list unavailable rather than treating it as confirmed absence', () => {
    const result = readBaselineSnapshot({ ...captured, active_orders: 'none' });
    expect(result.status).toBe('unavailable');
  });

  it('marks a snapshot without a capture time unavailable', () => {
    expect(readBaselineSnapshot({ ...captured, captured_at: null }).status).toBe('unavailable');
  });

  it('renders confirmed absence explicitly when the captured lists are empty', () => {
    const lines = renderBaselineReference(readBaselineSnapshot({ ...captured, medications: [], active_orders: [] }));
    expect(lines).toContain('- Medications: none recorded in the verified baseline.');
    expect(lines).toContain('- Active orders: none recorded in the verified baseline.');
  });

  it('renders discontinued and expired statuses so they cannot be mistaken for active authorization', () => {
    const lines = renderBaselineReference(readBaselineSnapshot({ ...captured, active_orders: [{ name: 'Lorazepam', status: 'discontinued', kind: 'prn' }] }));
    expect(lines.join('\n')).toContain('Lorazepam [discontinued, prn]');
  });
});
