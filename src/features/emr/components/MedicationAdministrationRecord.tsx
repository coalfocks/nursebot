import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Clock3, Edit3, History, Pill, Save, Search } from 'lucide-react';
import type { MedicalOrder, MarAdministrationEvent, MarStatus, Patient } from '../lib/types';
import { emrApi } from '../lib/api';
import { expandMarSchedule } from '../lib/marSchedule';
import { useAuthStore } from '../../../stores/authStore';
import { hasAdminAccess } from '../../../lib/roles';

interface MedicationAdministrationRecordProps {
  patient: Patient;
  assignmentId?: string;
  readOnly?: boolean;
  forceBaseline?: boolean;
}

const statusOptions: MarStatus[] = ['Given', 'Held', 'Refused', 'Not given', 'Started', 'Rate changed', 'Stopped', 'Not documented'];
const categories = ['scheduled', 'prn', 'one_time', 'infusion'] as const;

export function MedicationAdministrationRecord({ patient, assignmentId, readOnly = false, forceBaseline = false }: MedicationAdministrationRecordProps) {
  const { profile } = useAuthStore();
  const canEdit = hasAdminAccess(profile) && !readOnly;
  const scopeAssignmentId = forceBaseline ? null : assignmentId ?? null;
  const [events, setEvents] = useState<MarAdministrationEvent[]>([]);
  const [orders, setOrders] = useState<MedicalOrder[]>([]);
  const [historyHours, setHistoryHours] = useState('12');
  const [categoryFilter, setCategoryFilter] = useState<'all' | typeof categories[number]>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [populateOpen, setPopulateOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ medicationName: '', orderedDose: '', administeredDose: '', unit: '', route: '', frequency: '', status: 'Not documented' as MarStatus, category: 'scheduled' as typeof categories[number], relativeOffsetHours: '0', reason: '' });
  const [populate, setPopulate] = useState({
    orderId: '', stayHours: '24', startPriorHours: '12', stopPriorHours: '1',
    frequency: 'q4h', category: 'scheduled' as typeof categories[number], assumePrnGiven: false,
    infusionStartPriorHours: '12', infusionChangePriorHours: '', infusionStopPriorHours: '',
    infusionRate: '', infusionChangeRate: '', infusionStopRate: '',
  });

  const load = useCallback(async () => {
    if (!patient.roomId) return;
    setLoading(true);
    setError(null);
    const [loadedEvents, loadedOrders, loadedRevision] = await Promise.all([
      emrApi.listMarEvents(patient.id, scopeAssignmentId ?? undefined, patient.roomId, (message) => setError(message)),
      emrApi.listOrders(patient.id, scopeAssignmentId ?? undefined, patient.roomId),
      emrApi.getMarHistoryRevision(patient.id, patient.roomId, scopeAssignmentId),
    ]);
    setEvents(loadedEvents);
    setOrders(loadedOrders.filter((order) => order.category === 'Medication'));
    setRevision(loadedRevision);
    setDirty(false);
    setLoading(false);
  }, [patient.id, patient.roomId, scopeAssignmentId]);

  useEffect(() => { void load(); }, [load]);

  const filteredEvents = useMemo(() => events.filter((event) => {
    const matchesCategory = categoryFilter === 'all' || event.category === categoryFilter;
    const matchesSearch = !search.trim() || event.medicationName.toLowerCase().includes(search.trim().toLowerCase());
    return matchesCategory && matchesSearch && (event.relativeOffsetHours == null || event.relativeOffsetHours <= Number(historyHours));
  }), [events, categoryFilter, search, historyHours]);

  const updateEvent = (id: string, patch: Partial<MarAdministrationEvent>) => {
    setEvents((current) => current.map((event) => event.id === id ? { ...event, ...patch } : event));
    setDirty(true);
  };

  const handlePopulate = () => {
    const order = orders.find((item) => item.id === populate.orderId);
    if (!order) return;
    const generated = expandMarSchedule({
      medicationName: order.orderName,
      orderId: order.id,
      orderedDose: order.dose,
      route: order.route,
      frequency: populate.frequency || order.frequency || 'q4h',
      category: populate.category,
      historyHours: Number(historyHours),
      stayHours: Number(populate.stayHours),
      startPriorHours: Number(populate.startPriorHours),
      firstDosePriorHours: Number(populate.startPriorHours),
      stopPriorHours: Number(populate.stopPriorHours),
      assumePrnGiven: populate.assumePrnGiven,
      infusionEvents: populate.category === 'infusion' ? [
        { offsetHours: Number(populate.infusionStartPriorHours), status: 'Started' as const, rate: populate.infusionRate || undefined },
        ...(populate.infusionChangePriorHours ? [{ offsetHours: Number(populate.infusionChangePriorHours), status: 'Rate changed' as const, rate: populate.infusionChangeRate || undefined }] : []),
        ...(populate.infusionStopPriorHours ? [{ offsetHours: Number(populate.infusionStopPriorHours), status: 'Stopped' as const, rate: populate.infusionStopRate || undefined }] : []),
      ] : undefined,
    });
    const mapped = generated.map((draft, index) => ({
      ...draft,
      id: crypto.randomUUID(),
      patientId: patient.id,
      roomId: patient.roomId as number,
      assignmentId: scopeAssignmentId,
      recordVersion: 1,
      source: 'authored_scenario' as const,
      actorLabel: profile?.full_name ?? 'Scenario author',
      caseVersion: null,
      administeredAt: null,
      occurrenceKey: draft.occurrenceKey || `${order.id}:${index}`,
    }));
    setEvents((current) => {
      const byKey = new Map(current.map((event) => [event.occurrenceKey, event]));
      mapped.forEach((event) => byKey.set(event.occurrenceKey, event));
      return Array.from(byKey.values());
    });
    setDirty(true);
    setPopulateOpen(false);
  };

  const save = async () => {
    if (!patient.roomId || !canEdit) return;
    setSaveError(null);
    const result = await emrApi.saveMarHistory(patient.id, patient.roomId, scopeAssignmentId, null, revision, events);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setRevision(result.revision);
    setDirty(false);
  };

  const addManual = () => {
    if (!patient.roomId || !manual.medicationName.trim()) return;
    const id = crypto.randomUUID();
    setEvents((current) => [...current, {
      id,
      patientId: patient.id,
      roomId: patient.roomId as number,
      assignmentId: scopeAssignmentId,
      orderId: null,
      caseVersion: null,
      occurrenceKey: `manual:${id}`,
      relativeOffsetHours: Math.min(72, Math.max(0, Number(manual.relativeOffsetHours) || 0)),
      administeredAt: null,
      medicationName: manual.medicationName.trim(),
      orderedDose: manual.orderedDose || null,
      administeredDose: manual.administeredDose || null,
      unit: manual.unit || null,
      route: manual.route || null,
      frequency: manual.frequency || null,
      category: manual.category,
      status: manual.status,
      simulatedClinician: profile?.full_name ?? 'Scenario author',
      reason: manual.reason || null,
      prnIndication: null,
      response: null,
      infusionDetails: null,
      source: 'authored_scenario',
      actorLabel: profile?.full_name ?? 'Scenario author',
      recordVersion: 1,
    }]);
    setManualOpen(false);
    setDirty(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2"><Pill className="h-5 w-5" /> Medication Administration Record</CardTitle>
            {canEdit && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setManualOpen((open) => !open)}><Edit3 className="mr-2 h-4 w-4" />Add administration</Button><Button variant="outline" onClick={() => setPopulateOpen((open) => !open)}><History className="mr-2 h-4 w-4" />Populate MAR</Button><Button onClick={() => void save()} disabled={!dirty}><Save className="mr-2 h-4 w-4" />Save MAR history</Button></div>}
          </div>
          <p className="text-sm text-muted-foreground">Blank means undocumented. Learner medication orders do not become Given automatically.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {populateOpen && canEdit && (
            <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Select value={populate.orderId} onValueChange={(value) => setPopulate((current) => ({ ...current, orderId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Medication order" /></SelectTrigger>
                  <SelectContent>{orders.map((order) => <SelectItem key={order.id} value={order.id}>{order.orderName}</SelectItem>)}</SelectContent>
                </Select>
                <Input aria-label="Admission or encounter hours" type="number" min="1" max="72" value={populate.stayHours} onChange={(event) => setPopulate((current) => ({ ...current, stayHours: event.target.value }))} placeholder="Stay hours (24/48/72)" />
                <Input aria-label="Medication start prior hours" type="number" min="0" max="72" value={populate.startPriorHours} onChange={(event) => setPopulate((current) => ({ ...current, startPriorHours: event.target.value }))} placeholder="Medication start prior hours" />
                <Input aria-label="Medication stop prior hours" type="number" min="1" max="72" value={populate.stopPriorHours} onChange={(event) => setPopulate((current) => ({ ...current, stopPriorHours: event.target.value }))} placeholder="Stop before page (hours)" />
                <Input aria-label="Frequency" value={populate.frequency} onChange={(event) => setPopulate((current) => ({ ...current, frequency: event.target.value }))} placeholder="q4h, TID, Once" />
                <Select value={populate.category} onValueChange={(value: typeof categories[number]) => setPopulate((current) => ({ ...current, category: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {populate.category === 'infusion' && <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Input aria-label="Infusion start prior hours" type="number" min="0" max="72" value={populate.infusionStartPriorHours} onChange={(event) => setPopulate((current) => ({ ...current, infusionStartPriorHours: event.target.value }))} placeholder="Start prior hours" />
                <Input aria-label="Infusion start rate" value={populate.infusionRate} onChange={(event) => setPopulate((current) => ({ ...current, infusionRate: event.target.value }))} placeholder="Start rate" />
                <Input aria-label="Infusion rate change prior hours" type="number" min="0" max="72" value={populate.infusionChangePriorHours} onChange={(event) => setPopulate((current) => ({ ...current, infusionChangePriorHours: event.target.value }))} placeholder="Rate change prior hours" />
                <Input aria-label="Infusion changed rate" value={populate.infusionChangeRate} onChange={(event) => setPopulate((current) => ({ ...current, infusionChangeRate: event.target.value }))} placeholder="Changed rate" />
                <Input aria-label="Infusion stop prior hours" type="number" min="0" max="72" value={populate.infusionStopPriorHours} onChange={(event) => setPopulate((current) => ({ ...current, infusionStopPriorHours: event.target.value }))} placeholder="Stop prior hours" />
                <Input aria-label="Infusion stop rate" value={populate.infusionStopRate} onChange={(event) => setPopulate((current) => ({ ...current, infusionStopRate: event.target.value }))} placeholder="Stop rate / note" />
              </div>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={populate.assumePrnGiven} onChange={(event) => setPopulate((current) => ({ ...current, assumePrnGiven: event.target.checked }))} /> Assume each PRN occurrence was given</label>
              <Button onClick={handlePopulate} disabled={!populate.orderId}>Preview occurrences</Button>
            </div>
          )}
          {manualOpen && canEdit && (
            <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Input aria-label="Medication name" value={manual.medicationName} onChange={(event) => setManual((current) => ({ ...current, medicationName: event.target.value }))} placeholder="Medication" />
                <Input aria-label="Ordered dose" value={manual.orderedDose} onChange={(event) => setManual((current) => ({ ...current, orderedDose: event.target.value }))} placeholder="Ordered dose" />
                <Input aria-label="Administered dose" value={manual.administeredDose} onChange={(event) => setManual((current) => ({ ...current, administeredDose: event.target.value }))} placeholder="Given dose" />
                <Input aria-label="Route" value={manual.route} onChange={(event) => setManual((current) => ({ ...current, route: event.target.value }))} placeholder="Route" />
                <Input aria-label="Frequency" value={manual.frequency} onChange={(event) => setManual((current) => ({ ...current, frequency: event.target.value }))} placeholder="Frequency" />
                <Input aria-label="Prior hours" type="number" min="0" max="72" value={manual.relativeOffsetHours} onChange={(event) => setManual((current) => ({ ...current, relativeOffsetHours: event.target.value }))} placeholder="Prior hours" />
                <Select value={manual.category} onValueChange={(value: typeof categories[number]) => setManual((current) => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select>
                <Select value={manual.status} onValueChange={(value: MarStatus) => setManual((current) => ({ ...current, status: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select>
              </div>
              <Input aria-label="Reason" value={manual.reason} onChange={(event) => setManual((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason / PRN indication / infusion note" />
              <Button onClick={addManual} disabled={!manual.medicationName.trim()}>Add to preview</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search medication" /></div>
            <Select value={historyHours} onValueChange={setHistoryHours}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{['12','24','48','72'].map((hours) => <SelectItem key={hours} value={hours}>{hours} hours</SelectItem>)}</SelectContent></Select>
            <Select value={categoryFilter} onValueChange={(value: 'all' | typeof categories[number]) => setCategoryFilter(value)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All groups</SelectItem>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select>
          </div>
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {saveError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>}
          {loading ? <div className="rounded-md border p-6 text-sm text-muted-foreground">Loading MAR history…</div> : filteredEvents.length === 0 ? <div className="rounded-md border p-6 text-sm text-muted-foreground">No documented administrations in this view.</div> : (
            <div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/30 text-left"><th className="p-3">Medication</th><th className="p-3">Ordered dose / route / frequency</th><th className="p-3">Last given</th><th className="p-3">Status</th><th className="p-3">Details</th></tr></thead><tbody>{filteredEvents.map((event) => <tr key={event.id} className="border-b last:border-0"><td className="p-3 font-medium">{event.medicationName}<div className="text-xs text-muted-foreground">{event.category}</div></td><td className="p-3">{[event.orderedDose, event.unit, event.route, event.frequency].filter(Boolean).join(' • ') || '—'}</td><td className="p-3">{event.relativeOffsetHours != null ? `${event.relativeOffsetHours}h prior` : event.administeredAt ? new Date(event.administeredAt).toLocaleString() : '—'}</td><td className="p-3">{canEdit ? <Select value={event.status} onValueChange={(value: MarStatus) => updateEvent(event.id, { status: value })}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select> : <Badge variant="outline">{event.status}</Badge>}</td><td className="p-3">{canEdit ? <Button size="sm" variant="ghost" aria-label={`Edit ${event.medicationName}`} onClick={() => updateEvent(event.id, { reason: event.reason ? undefined : 'Documented by scenario author' })}><Edit3 className="h-4 w-4" /></Button> : <span className="text-xs text-muted-foreground">{event.administeredDose || 'Dose not documented'}{event.route ? ` • ${event.route}` : ''}</span>}</td></tr>)}</tbody></table></div>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" /> Authored baseline times are shown as prior-hour offsets; real attempt administrations use persisted server times.</div>
        </CardContent>
      </Card>
    </div>
  );
}
