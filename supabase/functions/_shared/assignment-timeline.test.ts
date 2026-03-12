import { describe, expect, it } from 'vitest';
import {
  buildAssignmentTimelineEntries,
  renderTimelineEntriesForEvaluation,
} from './assignment-timeline';

describe('assignment timeline for evaluation', () => {
  it('includes the full assignment timeline in chronological order and keeps the progress note last', () => {
    const entries = buildAssignmentTimelineEntries({
      assignment: {
        id: 'assignment-1',
        completed_at: '2026-03-12T10:40:00.000Z',
        student_progress_note: 'Likely sepsis from pneumonia. Broad antibiotics, fluids, cultures, and reassess lactate.',
      },
      assignmentId: 'assignment-1',
      targetRoomIds: [7, 4],
      messages: [
        {
          id: 'message-1',
          assignment_id: 'assignment-1',
          role: 'student',
          content: 'Please repeat vitals and send a lactate.',
          created_at: '2026-03-12T10:00:00.000Z',
        },
        {
          id: 'message-2',
          assignment_id: 'assignment-1',
          role: 'assistant',
          content: '<completed>',
          created_at: '2026-03-12T10:35:00.000Z',
        },
      ],
      orders: [
        {
          id: 'order-1',
          assignment_id: 'assignment-1',
          room_id: 7,
          override_scope: 'assignment',
          category: 'Medication',
          order_name: 'Piperacillin-tazobactam',
          dose: '4.5 g',
          route: 'IV',
          frequency: 'q6h',
          priority: 'STAT',
          status: 'Active',
          instructions: null,
          order_time: '2026-03-12T10:05:00.000Z',
          created_at: '2026-03-12T10:05:00.000Z',
        },
      ],
      labs: [
        {
          id: 'lab-1',
          assignment_id: 'assignment-1',
          room_id: 7,
          override_scope: 'assignment',
          test_name: 'Lactate',
          value: 4.2,
          unit: 'mmol/L',
          status: 'Critical',
          collection_time: '2026-03-12T10:10:00.000Z',
          result_time: '2026-03-12T10:15:00.000Z',
          created_at: '2026-03-12T10:15:00.000Z',
        },
        {
          id: 'lab-2',
          assignment_id: null,
          room_id: null,
          override_scope: 'baseline',
          test_name: 'Creatinine',
          value: 1.1,
          unit: 'mg/dL',
          status: 'Normal',
          collection_time: '2000-01-01T00:00:00.000Z',
          result_time: '2000-01-01T00:00:00.000Z',
          created_at: '2026-03-12T09:50:00.000Z',
        },
      ],
      vitals: [
        {
          id: 'vital-1',
          assignment_id: 'assignment-1',
          room_id: 7,
          override_scope: 'assignment',
          timestamp: '2026-03-12T10:20:00.000Z',
          temperature: 102.1,
          blood_pressure_systolic: 88,
          blood_pressure_diastolic: 50,
          heart_rate: 128,
          respiratory_rate: 28,
          oxygen_saturation: 91,
          pain: 0,
        },
      ],
      imaging: [
        {
          id: 'imaging-1',
          assignment_id: 'assignment-1',
          room_id: 7,
          override_scope: 'assignment',
          order_name: 'Portable chest x-ray',
          study_type: 'Chest X-Ray',
          status: 'Completed',
          report: 'Right lower lobe consolidation.',
          order_time: '2026-03-12T10:25:00.000Z',
          report_generated_at: '2026-03-12T10:30:00.000Z',
          created_at: '2026-03-12T10:30:00.000Z',
        },
      ],
    });

    expect(entries.map((entry) => entry.kind)).toEqual([
      'labs',
      'message',
      'order',
      'labs',
      'vital',
      'imaging',
      'completion',
      'progress-note',
    ]);

    const rendered = renderTimelineEntriesForEvaluation(entries);
    expect(rendered).toContain('Student message');
    expect(rendered).toContain('Order: Piperacillin-tazobactam');
    expect(rendered).toContain('Lab results (1)');
    expect(rendered).toContain('Vitals updated');
    expect(rendered).toContain('Imaging: Portable chest x-ray');
    expect(rendered).toContain('Student progress note');
    expect(rendered).toContain('Likely sepsis from pneumonia');

    expect(rendered.indexOf('Student progress note')).toBeGreaterThan(rendered.indexOf('Case completed'));
    expect(rendered).toContain('[2026-03-12T09:50:00.000Z] Lab results (1)');
  });

  it('filters out unrelated room-scoped and assignment-scoped events', () => {
    const rendered = renderTimelineEntriesForEvaluation(
      buildAssignmentTimelineEntries({
        assignment: {
          id: 'assignment-1',
          completed_at: null,
          student_progress_note: null,
        },
        assignmentId: 'assignment-1',
        targetRoomIds: [7, 4],
        messages: [],
        orders: [
          {
            id: 'order-keep',
            assignment_id: null,
            room_id: 4,
            override_scope: 'room',
            category: 'Lab',
            order_name: 'CBC',
            dose: null,
            route: null,
            frequency: null,
            priority: 'Routine',
            status: 'Active',
            instructions: null,
            order_time: '2026-03-12T10:00:00.000Z',
            created_at: '2026-03-12T10:00:00.000Z',
          },
          {
            id: 'order-drop-room',
            assignment_id: null,
            room_id: 99,
            override_scope: 'room',
            category: 'Lab',
            order_name: 'BMP',
            dose: null,
            route: null,
            frequency: null,
            priority: 'Routine',
            status: 'Active',
            instructions: null,
            order_time: '2026-03-12T10:01:00.000Z',
            created_at: '2026-03-12T10:01:00.000Z',
          },
          {
            id: 'order-drop-assignment',
            assignment_id: 'assignment-2',
            room_id: 7,
            override_scope: 'assignment',
            category: 'Medication',
            order_name: 'Vancomycin',
            dose: null,
            route: null,
            frequency: null,
            priority: 'Routine',
            status: 'Active',
            instructions: null,
            order_time: '2026-03-12T10:02:00.000Z',
            created_at: '2026-03-12T10:02:00.000Z',
          },
        ],
        labs: [],
        vitals: [],
        imaging: [],
      }),
    );

    expect(rendered).toContain('Order: CBC');
    expect(rendered).not.toContain('Order: BMP');
    expect(rendered).not.toContain('Order: Vancomycin');
  });
});
