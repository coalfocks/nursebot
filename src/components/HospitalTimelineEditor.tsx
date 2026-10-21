import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  entryRelativeHours,
  parseHospitalTimeline,
  relativeOffsetLabel,
  type EncounterType,
  type HospitalTimeline,
  type HospitalTimelineEntry,
} from '../lib/hospitalTimeline';

type Props = { value: string; encounterType: EncounterType; stayDays?: number; onChange: (value: string) => void };

const kinds: HospitalTimelineEntry['kind'][] = ['admission', 'progress_note', 'consult', 'lab', 'vital', 'imaging', 'procedure', 'nurse_page'];

const emptyEntry = (kind: HospitalTimelineEntry['kind'], index: number): HospitalTimelineEntry => ({
  id: `timeline-${Date.now()}-${index}`,
  kind,
  hospitalDay: 1,
  relativeHoursBeforeEncounter: 12,
  title: kind === 'progress_note' ? 'Progress note' : kind === 'nurse_page' ? 'Nurse page' : '',
  content: '',
});

export function HospitalTimelineEditor({ value, encounterType, stayDays, onChange }: Props) {
  const timeline = useMemo(() => ({
    ...parseHospitalTimeline(safeJson(value)),
    encounterType,
    ...(Number.isInteger(stayDays) && stayDays >= 1 && stayDays <= 3 ? { stayDays } : {}),
  }), [value, encounterType, stayDays]);
  const update = (entries: HospitalTimelineEntry[]) => onChange(JSON.stringify({ ...timeline, encounterType, entries }, null, 2));
  const updateEntry = (index: number, changes: Partial<HospitalTimelineEntry>) => update(timeline.entries.map((entry, i) => i === index ? { ...entry, ...changes } : entry));

  return <div className="space-y-3">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Relative chart history</p>
        <p className="text-xs text-slate-500">Every baseline item is shown as elapsed time before the student encounter. Calendar dates, clock times, and hospital-day labels are not displayed to learners.</p>
      </div>
      <button type="button" onClick={() => update([...timeline.entries, emptyEntry('progress_note', timeline.entries.length)])} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"><Plus className="h-3 w-3" /> Add entry</button>
    </div>
    <div className="space-y-3">
      {timeline.entries.length === 0 && <p className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500">No pre-page entries yet. Add only facts intentionally authored for this case.</p>}
      {timeline.entries.map((entry, index) => <div key={entry.id} className="rounded border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
          <label className="text-xs font-medium text-slate-600">Type<select value={entry.kind} onChange={(e) => updateEntry(index, { kind: e.target.value as HospitalTimelineEntry['kind'] })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs">{kinds.map((kind) => <option key={kind} value={kind}>{kind.replace('_', ' ')}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-600">Hours prior<input type="number" min="0" max={timeline.stayDays * 24} value={entryRelativeHours(entry)} onChange={(e) => updateEntry(index, { relativeHoursBeforeEncounter: Number(e.target.value), offsetHours: undefined })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" /></label>
          <label className="text-xs font-medium text-slate-600">Internal day<select value={entry.hospitalDay} onChange={(e) => updateEntry(index, { hospitalDay: Number(e.target.value) })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs">{Array.from({ length: timeline.stayDays }, (_, day) => <option key={day + 1} value={day + 1}>Day {day + 1}</option>)}</select></label>
          <button type="button" aria-label={`Remove ${entry.title || 'timeline entry'}`} onClick={() => update(timeline.entries.filter((_, i) => i !== index))} className="mt-5 rounded p-1 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
        </div>
        <p className="mt-2 text-xs font-semibold text-blue-700">Learner-facing label: {relativeOffsetLabel(entry)}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">Title<input value={entry.title} onChange={(e) => updateEntry(index, { title: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" /></label>
          <label className="text-xs font-medium text-slate-600">Content / findings<textarea value={entry.content} onChange={(e) => updateEntry(index, { content: e.target.value })} rows={2} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" /></label>
        </div>
        {entry.kind === 'lab' && <div className="mt-2 grid gap-2 sm:grid-cols-3"><Field label="Analyte" value={entry.analyte} onChange={(v) => updateEntry(index, { analyte: v })} /><Field label="Value" value={entry.value} onChange={(v) => updateEntry(index, { value: v })} /><Field label="Unit" value={entry.unit} onChange={(v) => updateEntry(index, { unit: v })} /></div>}
        {entry.kind === 'consult' && <div className="mt-2 grid gap-2 sm:grid-cols-2"><Field label="Consultant" value={entry.consultant} onChange={(v) => updateEntry(index, { consultant: v })} /><Field label="Recommendation" value={entry.recommendation} onChange={(v) => updateEntry(index, { recommendation: v })} /></div>}
        {entry.kind === 'imaging' && <div className="mt-2 grid gap-2 sm:grid-cols-3"><Field label="Study type" value={entry.studyType} onChange={(v) => updateEntry(index, { studyType: v })} /><Field label="Report" value={entry.report} onChange={(v) => updateEntry(index, { report: v })} /><Field label="Impression" value={entry.impression} onChange={(v) => updateEntry(index, { impression: v })} /></div>}
      </div>)}
    </div>
  </div>;
}

function Field({ label, value, onChange }: { label: string; value?: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-medium text-slate-600">{label}<input value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" /></label>;
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}
