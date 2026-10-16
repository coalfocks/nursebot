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
    expect(rendered).toContain('Lab result: Lactate');
    expect(rendered).toContain('Vitals updated');
    expect(rendered).toContain('Imaging: Portable chest x-ray');
    expect(rendered).toContain('Student progress note');
    expect(rendered).toContain('Likely sepsis from pneumonia');

    expect(rendered.indexOf('Student progress note')).toBeGreaterThan(rendered.indexOf('Case completed'));
    expect(rendered).toContain('[2026-03-12T09:50:00.000Z] Lab result: Creatinine');
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

  it('labels patient and consultant directions and keeps pre-page conversation out of scored evidence', () => {
    const entries = buildAssignmentTimelineEntries({
      assignment: { id: 'assignment-1', completed_at: null, student_progress_note: null },
      assignmentId: 'assignment-1',
      targetRoomIds: [7],
      messages: [],
      patientMessages: [
        { id: 'patient-pre', assignment_id: 'assignment-1', role: 'student', content: 'before page', created_at: '2026-03-12T09:59:00.000Z' },
        { id: 'patient-question', assignment_id: 'assignment-1', role: 'student', content: 'post-page question', created_at: '2026-03-12T10:01:00.000Z' },
        { id: 'patient-reply', assignment_id: 'assignment-1', role: 'patient', content: 'simulated reply', created_at: '2026-03-12T10:02:00.000Z' },
      ],
      consultantMessages: [
        { id: 'consult-pre', assignment_id: 'assignment-1', role: 'student', content: 'before page consult', specialty: 'Cardiology', urgency: 'routine', created_at: '2026-03-12T09:59:30.000Z' },
        { id: 'consult-request', assignment_id: 'assignment-1', role: 'student', content: 'post-page consult request', specialty: 'Cardiology', urgency: 'urgent', created_at: '2026-03-12T10:03:00.000Z' },
        { id: 'consult-reply', assignment_id: 'assignment-1', role: 'consultant', content: 'simulated consultant reply', specialty: 'Cardiology', urgency: 'urgent', created_at: '2026-03-12T10:04:00.000Z' },
      ],
      orders: [], labs: [], vitals: [], imaging: [],
    });
    const scored = entries.filter((entry) => new Date(entry.timestamp).getTime() >= new Date('2026-03-12T10:00:00.000Z').getTime());
    expect(scored.map((entry) => [entry.id, entry.title, entry.meta?.find((value) => value.startsWith('Author:'))])).toEqual([
      ['patient-message-patient-question', 'Student to patient', 'Author: Student'],
      ['patient-message-patient-reply', 'Patient response', 'Author: Patient'],
      ['consultant-message-consult-request', 'Consult request (Cardiology)', 'Author: Student'],
      ['consultant-message-consult-reply', 'Consultant response', 'Author: Consultant'],
    ]);
    expect(scored.some((entry) => entry.id.includes('pre'))).toBe(false);
  });

  it('preserves explicit learner bedside and team actions as distinct evidence', () => {
    const entries = buildAssignmentTimelineEntries({
      assignment: { id: 'assignment-1', completed_at: null, student_progress_note: null },
      assignmentId: 'assignment-1',
      targetRoomIds: [7],
      messages: [], orders: [], labs: [], vitals: [], imaging: [],
      learnerActions: [
        { id: 'action-1', assignment_id: 'assignment-1', room_id: 7, action_type: 'bedside_finding', channel: 'bedside', content: 'Cool extremities and delayed capillary refill.', occurred_at: '2026-03-12T10:01:00.000Z', created_at: '2026-03-12T10:01:00.000Z' },
        { id: 'action-2', assignment_id: 'assignment-1', room_id: 7, action_type: 'team_escalation', channel: 'team', content: 'Escalated to senior clinician.', occurred_at: '2026-03-12T10:02:00.000Z', created_at: '2026-03-12T10:02:00.000Z' },
      ],
    });
    expect(entries.map((entry) => entry.id)).toEqual(['learner-action-action-1', 'learner-action-action-2']);
    expect(entries[0].meta).toContain('Channel: bedside');
    expect(entries[1].meta).toContain('Channel: team');
  });

  it('excludes authored pre-page chart rows from learner evidence', () => {
    const entries = buildAssignmentTimelineEntries({
      assignment: { id: 'assignment-1', completed_at: null, student_progress_note: null },
      assignmentId: 'assignment-1',
      targetRoomIds: [7],
      messages: [], orders: [],
      labs: [{
        id: 'seed-lab', assignment_id: null, room_id: 7, override_scope: 'room',
        timeline_entry_id: 'day-1-wbc', test_name: 'WBC', value: 12, unit: 'K/uL', status: 'Unknown',
        collection_time: '2026-03-12T08:00:00.000Z', result_time: '2026-03-12T08:00:00.000Z', created_at: '2026-03-12T08:00:00.000Z',
      }],
      vitals: [], imaging: [],
    });
    expect(entries).toEqual([]);
  });

  it('uses assignment insertion time for legacy learner orders/results written with a baseline clock', () => {
    const entries = buildAssignmentTimelineEntries({
      assignment: { id: 'attempt-1', completed_at: null, student_progress_note: null },
      assignmentId: 'attempt-1', targetRoomIds: [24], messages: [], learnerActions: [],
      orders: [{ id: 'order-1', assignment_id: 'attempt-1', room_id: 24, override_scope: 'assignment', category: 'Lab', order_name: 'STAT CBC', dose: null, route: null, frequency: 'Once', priority: 'STAT', status: 'Completed', instructions: null, order_time: '2000-01-01T00:00:00.000Z', created_at: '2026-10-15T22:33:43.000Z' }],
      labs: [{ id: 'lab-1', assignment_id: 'attempt-1', room_id: 24, override_scope: 'assignment', test_name: 'WBC', value: 15, unit: 'K/uL', status: 'Abnormal', collection_time: '2000-01-01T00:00:00.000Z', result_time: '2000-01-01T00:00:00.000Z', created_at: '2026-10-15T22:33:51.000Z' }],
      vitals: [], imaging: [],
    });
    expect(entries.find((entry) => entry.kind === 'order')?.timestamp).toBe('2026-10-15T22:33:43.000Z');
    expect(entries.find((entry) => entry.kind === 'labs')?.timestamp).toBe('2026-10-15T22:33:51.000Z');
  });

  it('keeps an assignment result even when the row has an authored timeline id', () => {
    const entries = buildAssignmentTimelineEntries({
      assignment: { id: 'attempt-1', completed_at: null, student_progress_note: null },
      assignmentId: 'attempt-1', targetRoomIds: [24], messages: [], learnerActions: [], orders: [],
      labs: [{ id: 'lab-cbc', assignment_id: 'attempt-1', room_id: 24, override_scope: 'assignment', timeline_entry_id: 'generated-cbc', test_name: 'WBC', value: 15.3, unit: 'K/uL', status: 'Abnormal', collection_time: '2000-01-01T00:00:00.000Z', result_time: '2000-01-01T00:00:00.000Z', created_at: '2026-10-15T22:33:51.000Z' }],
      vitals: [], imaging: [],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'lab-lab-cbc', title: 'Lab result: WBC', body: 'WBC: 15.3 K/uL' });
  });
});
