import { describe, expect, it } from 'vitest';
import { buildStudentTimeline } from './studentTimeline';

describe('student timeline', () => {
  it('merges persisted messages, orders, notes, hints, and progress notes chronologically', () => {
    const events = buildStudentTimeline(
      [{ id: 'm1', assignment_id: 'a1', role: 'student', content: 'I am here', created_at: '2026-01-01T01:00:00Z', tokens_used: null, triggered_completion: false }],
      [{ id: 'o1', order_name: 'CBC', category: 'Lab', dose: null, route: null, frequency: null, priority: 'STAT', status: 'Pending', instructions: null, order_time: '2026-01-01T02:00:00Z' }],
      [{ id: 'n1', title: 'Progress', note_type: 'Progress', content: 'Stable', timestamp: '2026-01-01T03:00:00Z' }],
      { id: 'a1', student_progress_note: 'Final note', completed_at: '2026-01-01T05:00:00Z', completion_hint_views: { safety: '2026-01-01T04:00:00Z' } },
    );

    expect(events.map((event) => event.kind)).toEqual(['message', 'order', 'progress-note', 'hint', 'progress-note']);
    expect(events[3].label).toBe('Completion hint viewed');
  });

  it('keeps patient and consultant messages as distinct event types', () => {
    const events = buildStudentTimeline([], [], [], { id: 'a1', student_progress_note: null, completed_at: null, completion_hint_views: {} }, {
      patient: [{ id: 'p1', role: 'user', content: 'Where does it hurt?', created_at: '2026-01-01T01:00:00Z' }],
      consultant: [{ id: 'c1', role: 'assistant', content: 'I will review it.', created_at: '2026-01-01T02:00:00Z' }],
    });

    expect(events.map((event) => event.label)).toEqual(['Patient question', 'Consultant reply']);
  });
});
