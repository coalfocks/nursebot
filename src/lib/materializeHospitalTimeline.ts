import type { HospitalTimeline, HospitalTimelineEntry } from './hospitalTimeline';
import { timelineEntryTimestamp } from './hospitalTimeline';

const numeric = (value: string | undefined) => {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export type TimelineChartContext = {
  patientId: string;
  roomId: number;
  schoolId: string;
  caseBlueprintId?: string | null;
  generatedAt?: string;
};

/** Pure adapter used by tests and migration/read-back tooling. Runtime writes use the RPC. */
export function buildTimelineChartRows(timeline: HospitalTimeline, context: TimelineChartContext) {
  const notes: Array<Record<string, unknown>> = [];
  const labs: Array<Record<string, unknown>> = [];
  const vitals: Array<Record<string, unknown>> = [];
  const timestamp = (entry: HospitalTimelineEntry) => timelineEntryTimestamp(timeline, entry, context.generatedAt);

  for (const entry of timeline.entries) {
    const at = timestamp(entry);
    const base = {
      patient_id: context.patientId,
      room_id: context.roomId,
      school_id: context.schoolId,
      case_blueprint_id: context.caseBlueprintId ?? null,
      override_scope: 'room',
      timeline_entry_id: entry.id,
      timestamp: at,
    };

    if (entry.kind === 'lab' && entry.analyte && entry.value && entry.unit) {
      const parsed = numeric(entry.value);
      labs.push({
        ...base,
        test_name: entry.analyte,
        value: parsed,
        value_type: parsed === null ? 'coded' : 'numeric',
        text_value: parsed === null ? entry.value : null,
        unit: entry.unit,
        reference_range: null,
        status: 'Unknown',
        collection_time: at,
        result_time: at,
        ordered_by: 'Authored pre-page timeline',
        lifecycle_status: 'resulted',
      });
    }

    if (entry.kind === 'vital' && entry.vitals && Object.keys(entry.vitals).length > 0) {
      vitals.push({
        ...base,
        temperature: entry.vitals.temperature ?? null,
        blood_pressure_systolic: entry.vitals.bloodPressureSystolic ?? null,
        blood_pressure_diastolic: entry.vitals.bloodPressureDiastolic ?? null,
        heart_rate: entry.vitals.heartRate ?? null,
        respiratory_rate: entry.vitals.respiratoryRate ?? null,
        oxygen_saturation: entry.vitals.oxygenSaturation ?? null,
        pain: entry.vitals.pain ?? null,
      });
    }

    if (entry.kind === 'admission' || entry.kind === 'progress_note' || entry.kind === 'consult' || entry.kind === 'procedure') {
      notes.push({
        ...base,
        note_type: entry.kind === 'admission' ? 'H&P' : entry.kind === 'progress_note' ? 'Progress' : entry.kind === 'consult' ? 'Consult' : 'Procedure',
        title: entry.title,
        content: entry.kind === 'consult' && entry.recommendation
          ? `${entry.content}\nRecommendation: ${entry.recommendation}`
          : entry.content,
        author: entry.consultant || 'Authored pre-page timeline',
        signed: true,
      });
    }
  }

  return { notes, labs, vitals };
}
