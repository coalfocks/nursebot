import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Clock3, Edit3, History, Pill, Save, Search } from 'lucide-react';
import type { MedicalOrder, MarAdministrationEvent, MarStatus, Patient } from '../lib/types';
import { emrApi } from '../lib/api';
import { expandMarSchedule } from '../lib/marSchedule';
import { useAuthStore } from '../../../stores/authStore';
import { hasAdminAccess } from '../../../lib/roles';
import { useRequestIdentity } from '../../../hooks/useRequestIdentity';
import { projectMedicationRows } from '../lib/marProjection';
import { marScopeKey } from '../lib/marScope';
import { manualMarCanEdit, manualMarTimelineCellOffsetPercent } from '../lib/manualMar';
import { authoredMarCaseVersion } from '../../../lib/marMaterialization';
import { learnerMarLoadState } from '../lib/marReadiness';

interface MedicationAdministrationRecordProps {
  patient: Patient;
  assignmentId?: string;
  /** Immutable assignment-pinned case version. Assignment MAR is read-only until present. */
  caseVersion?: string | null;
  readOnly?: boolean;
  forceBaseline?: boolean;
}

interface PendingMarSave {
  requestId: string;
  payloadHash: string;
  expectedRevision: number;
  events: MarAdministrationEvent[];
  patientId: string;
  roomId: number;
  assignmentId: string | null;
  caseVersion: string | null;
  actorId: string;
}

const marPayloadHash = (events: MarAdministrationEvent[]) => JSON.stringify(events);
const readPendingMarSave = (key: string): PendingMarSave | null => {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? 'null') as PendingMarSave | null;
    return value && typeof value.requestId === 'string' && Array.isArray(value.events) ? value : null;
  } catch {
    return null;
  }
};

const statusOptions: MarStatus[] = ['Given', 'Held', 'Refused', 'Not given', 'Started', 'Rate changed', 'Stopped', 'Not documented'];
const categories = ['scheduled', 'prn', 'one_time', 'infusion'] as const;

export function MedicationAdministrationRecord({ patient, assignmentId, caseVersion, readOnly = false, forceBaseline = false }: MedicationAdministrationRecordProps) {
  const { profile } = useAuthStore();
  const actorId = profile?.id ?? 'anonymous';
  const actorAvailable = Boolean(profile?.id);
  const [path, setPath] = useState<'automatic' | 'manual' | 'unavailable'>('unavailable');
  const [schemaReady, setSchemaReady] = useState(false);
  // Admin authoring may create the first immutable assignment snapshot. Learner
  // reads still require the already-pinned version and never enter this path.
  const effectiveCaseVersion = caseVersion ?? (forceBaseline ? (patient.roomId ? authoredMarCaseVersion(patient.roomId) : null) : null);
  // Baseline authoring must use the same stable room case key that normal and
  // disposable assignments receive, so a learner can read the saved packet
  // without copying it into learner-action tables.
  const manualCaseVersion = effectiveCaseVersion ?? (patient.roomId ? authoredMarCaseVersion(patient.roomId) : 'manual-v1');
  const scopeAssignmentId = forceBaseline ? null : assignmentId ?? null;
  const scopeKey = marScopeKey({ patientId: patient.id, roomId: patient.roomId, assignmentId: scopeAssignmentId, caseVersion: manualCaseVersion ?? effectiveCaseVersion, actorId });
  const recoveryKey = `mar-save:${scopeKey}`;
  const { capture, isCurrent } = useRequestIdentity(scopeKey);
  const [events, setEvents] = useState<MarAdministrationEvent[]>([]);
  const [orders, setOrders] = useState<MedicalOrder[]>([]);
  const [historyHours, setHistoryHours] = useState('12');
  const [categoryFilter, setCategoryFilter] = useState<'all' | typeof categories[number]>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [baselineReady, setBaselineReady] = useState(forceBaseline || !assignmentId);
  const [dirty, setDirty] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Partial<MarAdministrationEvent>>({});
  const [expandedMedicationKeys, setExpandedMedicationKeys] = useState<Set<string>>(new Set());
  const [obsoleteKeys, setObsoleteKeys] = useState<Set<string>>(new Set());
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingMarSave | null>(() => readPendingMarSave(recoveryKey));
  const [populateOpen, setPopulateOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ medicationName: '', orderedDose: '', administeredDose: '', unit: '', route: '', frequency: '', status: 'Not documented' as MarStatus, category: 'scheduled' as typeof categories[number], relativeOffsetHours: '0', reason: '', prnIndication: '', response: '', infusionDetails: '' });
  const [populate, setPopulate] = useState({
    orderId: '', stayHours: '24', startPriorHours: '12', stopPriorHours: '1',
    frequency: 'q4h', explicitPriorHours: '', category: 'scheduled' as typeof categories[number], assumePrnGiven: false,
    infusionStartPriorHours: '12', infusionChangePriorHours: '', infusionStopPriorHours: '',
    infusionRate: '', infusionChangeRate: '', infusionStopRate: '',
  });
  const canEdit = path === 'manual'
    ? manualMarCanEdit(profile?.role, readOnly, schemaReady, assignmentId) && !pendingSave
    : hasAdminAccess(profile) && !readOnly && schemaReady && forceBaseline && !assignmentId;

  useEffect(() => {
    setPendingSave(readPendingMarSave(recoveryKey));
    setEvents([]);
    setOrders([]);
    setError(null);
    setSaveError(null);
    setRevision(0);
    setDirty(false);
    setSchemaReady(false);
    setPath('unavailable');
    setBaselineReady(forceBaseline || !assignmentId);
    // Scope changes must not carry an editor, preview, expansion, or draft
    // from another patient/assignment/actor into the new chart.
    setEditingId(null);
    setEditingDraft({});
    setExpandedMedicationKeys(new Set());
    setObsoleteKeys(new Set());
    setPreviewMessage(null);
    setPopulateOpen(false);
    setManualOpen(false);
  }, [assignmentId, forceBaseline, recoveryKey, scopeKey]);

  const load = useCallback(async () => {
    if (!patient.roomId || !actorAvailable) {
      setLoading(false);
      setSchemaReady(false);
      setBaselineReady(false);
      return;
    }
    const request = capture();
    setLoading(true);
    setError(null);
    if (assignmentId) {
      const learnerState = learnerMarLoadState(effectiveCaseVersion, true);
      if (learnerState.kind === 'missing_snapshot') {
        setEvents([]);
        setOrders([]);
        setRevision(0);
        setBaselineReady(false);
        setSchemaReady(false);
        setPath('unavailable');
        setDirty(false);
        setError(learnerState.message);
        setLoading(false);
        return;
      }
    }
    // Reader choice is assignment-scoped. A global automatic schema can be
    // installed while a sandbox assignment is intentionally backed by the
    // immutable manual packet contract; admin baseline reads also remain on
    // the established manual packet path.
    const assignmentReader = assignmentId ? await emrApi.getMarAssignmentReader(assignmentId) : null;
    if (!isCurrent(request)) return;
    const marReady = !forceBaseline && assignmentReader !== 'manual' && await emrApi.getMarReadiness();
    if (!isCurrent(request)) return;
    if (!marReady) {
      const manualReady = await emrApi.getManualMarReadiness();
      if (!isCurrent(request)) return;
      if (!manualReady.ready || (assignmentId && !effectiveCaseVersion)) {
          if (!isCurrent(request)) return;
        setEvents([]); setOrders([]); setRevision(0); setBaselineReady(false); setSchemaReady(false); setPath('unavailable'); setDirty(false); setError(manualReady.ready ? 'Medication history is unavailable for this attempt.' : 'Medication history is temporarily unavailable because the MAR reader is not ready.'); setLoading(false); return;
      }
      const packet = await emrApi.readManualMarPacket(patient.id, patient.roomId, scopeAssignmentId, manualCaseVersion);
      if (!isCurrent(request)) return;
      if (packet.status === 'unavailable' || packet.status === 'error') {
        if (!isCurrent(request)) return;
        setEvents([]); setOrders([]); setRevision(0); setBaselineReady(false); setSchemaReady(false); setPath('unavailable'); setError(packet.error ?? 'Manual MAR packet is unavailable.'); setDirty(false); setLoading(false); return;
      }
      const loadedEvents = packet.packet?.events ?? [];
      const loadedHash = marPayloadHash(loadedEvents);
      const pendingMatchesScope = pendingSave && pendingSave.patientId === patient.id && pendingSave.roomId === patient.roomId
        && pendingSave.assignmentId === scopeAssignmentId && pendingSave.caseVersion === manualCaseVersion && pendingSave.actorId === actorId;
      const recovered = pendingMatchesScope && pendingSave.payloadHash !== loadedHash ? pendingSave.events : loadedEvents;
      if (pendingMatchesScope && pendingSave.payloadHash === loadedHash) {
        window.localStorage.removeItem(recoveryKey);
        setPendingSave(null);
      } else if (pendingMatchesScope && recovered !== loadedEvents) {
        setPreviewMessage('A frozen manual MAR save is pending authoritative reconciliation. Editing is disabled; retry the same save or reload after the server confirms it.');
      }
      setEvents(recovered);
      setOrders([]);
      setRevision(pendingMatchesScope && recovered !== loadedEvents ? pendingSave.expectedRevision : (packet.packet?.revision ?? 0));
      setBaselineReady(true);
      setSchemaReady(true);
      setPath('manual');
      setDirty(Boolean(pendingMatchesScope && recovered !== loadedEvents));
      setLoading(false);
      return;
    }
    setPath('automatic');
    const [loadedEvents, loadedOrders, loadedRevision, baseline] = await Promise.all([
      emrApi.listMarEvents(patient.id, scopeAssignmentId ?? undefined, patient.roomId, effectiveCaseVersion, (message) => { if (isCurrent(request)) setError(message); }),
      emrApi.listOrders(patient.id, scopeAssignmentId ?? undefined, patient.roomId),
      emrApi.getMarHistoryRevision(patient.id, patient.roomId, scopeAssignmentId),
      assignmentId && !forceBaseline ? emrApi.getMarBaselineVersion(assignmentId) : Promise.resolve(null),
    ]);
    if (!isCurrent(request)) return;
    const loadedHash = marPayloadHash(loadedEvents);
    const recovered = pendingSave && pendingSave.patientId === patient.id && pendingSave.roomId === patient.roomId
      && pendingSave.assignmentId === scopeAssignmentId && pendingSave.caseVersion === effectiveCaseVersion
      && pendingSave.actorId === actorId
      && pendingSave.payloadHash !== loadedHash
      ? pendingSave.events
      : loadedEvents;
    if (pendingSave && recovered === loadedEvents && pendingSave.payloadHash === loadedHash) {
      window.localStorage.removeItem(recoveryKey);
      setPendingSave(null);
    } else if (pendingSave && recovered !== loadedEvents) {
      setPreviewMessage('Recovered a frozen MAR save for this assignment. Resume saves the original request; edit the preview to create a new request.');
    }
    setEvents(recovered);
    setOrders(loadedOrders.filter((order) => order.category === 'Medication'));
    setRevision(pendingSave && recovered !== loadedEvents ? pendingSave.expectedRevision : loadedRevision);
    setBaselineReady(forceBaseline || !assignmentId || Boolean(baseline && baseline.caseVersion === effectiveCaseVersion));
    setSchemaReady(true);
    setDirty(Boolean(pendingSave && recovered !== loadedEvents));
    setLoading(false);
  }, [actorAvailable, actorId, assignmentId, capture, effectiveCaseVersion, forceBaseline, isCurrent, manualCaseVersion, patient.id, patient.roomId, pendingSave, recoveryKey, scopeAssignmentId]);

  useEffect(() => { void load(); }, [load]);

  const filteredEvents = useMemo(() => events.filter((event) => {
    const matchesCategory = categoryFilter === 'all' || event.category === categoryFilter;
    const matchesSearch = !search.trim() || event.medicationName.toLowerCase().includes(search.trim().toLowerCase());
    return matchesCategory && matchesSearch && (event.relativeOffsetHours == null || event.relativeOffsetHours <= Number(historyHours));
  }), [events, categoryFilter, search, historyHours]);

  const isConfirmedManualMarConflict = (message: string) =>
    /^MANUAL_MAR_(REVISION_CONFLICT|RETRY_PAYLOAD_MISMATCH|INVALID_REQUEST|EVENTS_ARRAY_REQUIRED|EVENT_OBJECT_REQUIRED|MEDICATION_REQUIRED|OCCURRENCE_REQUIRED|CATEGORY_INVALID|STATUS_INVALID|LEARNER_SOURCE_REJECTED|SOURCE_INVALID|ORDER_ID_NOT_ALLOWED|RELATIVE_HOURS_INVALID)/.test(message);

  const updateEvent = (id: string, patch: Partial<MarAdministrationEvent>) => {
    if (pendingSave) {
      setSaveError('A manual MAR save has an unknown outcome. Resume the frozen save before editing.');
      return;
    }
    setEvents((current) => current.map((event) => event.id === id ? { ...event, ...patch } : event));
    setDirty(true);
  };

  const handlePopulate = () => {
    if (pendingSave) {
      setSaveError('A manual MAR save has an unknown outcome. Resume the frozen save before editing.');
      return;
    }
    const order = orders.find((item) => item.id === populate.orderId);
    if (!order) return;
    try {
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
      explicitPriorHours: populate.explicitPriorHours.split(',').map((value) => value.trim()).filter(Boolean).map(Number),
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
      caseVersion: effectiveCaseVersion,
      administeredAt: null,
      occurrenceKey: draft.occurrenceKey || `${order.id}:${index}`,
    }));
    setEvents((current) => {
      const byKey = new Map(current.map((event) => [event.occurrenceKey, event]));
      const generatedKeys = new Set(mapped.map((event) => event.occurrenceKey));
      const removed = new Set(current.filter((event) => event.orderId === order.id && !generatedKeys.has(event.occurrenceKey)).map((event) => event.occurrenceKey));
      setObsoleteKeys(removed);
      mapped.forEach((event) => {
        // Never overwrite an explicit Held/Refused/Not given edit during regeneration.
        if (!byKey.has(event.occurrenceKey)) byKey.set(event.occurrenceKey, event);
      });
      return Array.from(byKey.values());
    });
      setPreviewMessage('Preview updated. Existing manual exceptions were preserved; obsolete occurrences remain visible until explicitly removed.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to expand this MAR schedule.');
      return;
    }
    setDirty(true);
    setPopulateOpen(false);
  };

  const save = async () => {
    const canResumeManual = path === 'manual' && Boolean(pendingSave) && !assignmentId;
    const canWriteAutomaticBaseline = path === 'automatic' && forceBaseline && !assignmentId && canEdit;
    if (!patient.roomId || (!canEdit && !canResumeManual) || (path === 'automatic' && !canWriteAutomaticBaseline)) return;
    const request = capture();
    setSaveError(null);
    // Once an outcome is unknown, Resume must use the exact frozen envelope;
    // never derive a new request from mutable UI state.
    const submittedEvents = pendingSave?.events ?? events;
    const payloadHash = pendingSave?.payloadHash ?? marPayloadHash(submittedEvents);
    const requestId = pendingSave?.requestId ?? crypto.randomUUID();
    const expectedRevision = pendingSave?.expectedRevision ?? revision;
    const envelope: PendingMarSave = pendingSave ?? { requestId, payloadHash, expectedRevision, events: submittedEvents, patientId: patient.id, roomId: patient.roomId, assignmentId: scopeAssignmentId, caseVersion: path === 'manual' ? manualCaseVersion : effectiveCaseVersion, actorId };
    setPendingSave(envelope);
    window.localStorage.setItem(recoveryKey, JSON.stringify(envelope));
    const result = path === 'manual'
      ? await emrApi.saveManualMarPacket({ patientId: patient.id, roomId: patient.roomId, caseVersion: manualCaseVersion, revision: expectedRevision, events: envelope.events }, requestId)
      : await emrApi.saveMarHistory(patient.id, patient.roomId, scopeAssignmentId, effectiveCaseVersion, expectedRevision, envelope.events, requestId);
    if (!isCurrent(request)) return;
    if (!result.ok) {
      if (path === 'manual' && isConfirmedManualMarConflict(result.error)) {
        // These errors are confirmed no-commit outcomes. Drop only this frozen
        // request; the effect reloads the authoritative packet and re-enables
        // a fresh edit/request after reconciliation.
        setPendingSave(null);
        window.localStorage.removeItem(recoveryKey);
        setDirty(false);
        setSaveError(`${result.error} No manual MAR change was committed. Reloading the authoritative packet.`);
      } else {
        setSaveError(`${result.error} Resume the same MAR save after reload; editing creates a new request.`);
      }
      return;
    }
    setRevision(result.revision);
    setBaselineReady(true);
    setDirty(false);
    setPendingSave(null);
    window.localStorage.removeItem(recoveryKey);
  };

  const addManual = () => {
    if (pendingSave) {
      setSaveError('A manual MAR save has an unknown outcome. Resume the frozen save before editing.');
      return;
    }
    if (!patient.roomId || !manual.medicationName.trim()) return;
    const relativeOffsetHours = Number(manual.relativeOffsetHours);
    if (!Number.isFinite(relativeOffsetHours) || relativeOffsetHours < 0 || relativeOffsetHours > 72) {
      setSaveError('MAR_INVALID_MANUAL_TIME: prior hours must be between 0 and 72.');
      return;
    }
    if (path === 'automatic' && relativeOffsetHours <= 0) {
      setSaveError('MAR_ZERO_HOUR_BASELINE: baseline administrations must be prior-hour events.');
      return;
    }
    const id = crypto.randomUUID();
    setEvents((current) => [...current, {
      id,
      patientId: patient.id,
      roomId: patient.roomId as number,
      assignmentId: scopeAssignmentId,
      orderId: null,
      caseVersion: effectiveCaseVersion,
      occurrenceKey: `manual:${id}`,
      relativeOffsetHours,
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
      prnIndication: manual.prnIndication || null,
      response: manual.response || null,
      infusionDetails: manual.infusionDetails ? { note: manual.infusionDetails } : null,
      source: 'authored_scenario',
      actorLabel: profile?.full_name ?? 'Scenario author',
      recordVersion: 1,
    }]);
    setManualOpen(false);
    setDirty(true);
  };

  const beginEdit = (event: MarAdministrationEvent) => {
    if (pendingSave) {
      setSaveError('A manual MAR save has an unknown outcome. Resume the frozen save before editing.');
      return;
    }
    setEditingId(event.id);
    setEditingDraft({ ...event });
  };

  const commitEdit = () => {
    if (!editingId || pendingSave) return;
    updateEvent(editingId, editingDraft);
    setEditingId(null);
    setEditingDraft({});
  };

  const lastGivenByMedication = useMemo(() => {
    const result = new Map<string, MarAdministrationEvent>();
    const givenEvents = events.filter((event) => event.status === 'Given');
    const baselineEvents = givenEvents.filter((event) => !event.administeredAt);
    const attemptEvents = givenEvents.filter((event) => Boolean(event.administeredAt));
    const orderedEvents = [...baselineEvents, ...attemptEvents];
    orderedEvents.forEach((event) => {
      const key = `${event.orderId ?? 'manual'}:${event.medicationName}`;
      const previous = result.get(key);
      const candidateTime = event.administeredAt ? Date.parse(event.administeredAt) : null;
      const previousTime = previous?.administeredAt ? Date.parse(previous.administeredAt) : null;
      const isAttemptEvent = Boolean(event.administeredAt);
      const isLater = isAttemptEvent
        ? candidateTime !== null && (previousTime === null || candidateTime > previousTime)
        : (event.relativeOffsetHours ?? Number.POSITIVE_INFINITY) > 0
          && (previous?.relativeOffsetHours == null || previous.relativeOffsetHours <= 0 || event.relativeOffsetHours < previous.relativeOffsetHours);
      if (!previous || isLater) result.set(key, event);
    });
    return result;
  }, [events]);

  const eventTimeLabel = (event: MarAdministrationEvent) => event.relativeOffsetHours != null
    ? (event.relativeOffsetHours <= 0 ? 'During encounter' : `${event.relativeOffsetHours}h prior`)
    : event.administeredAt ? (adminContext ? new Date(event.administeredAt).toLocaleString() : 'During encounter') : '—';

  const lastGivenLabel = (event: MarAdministrationEvent, order?: MedicalOrder) => {
    const key = `${order?.id ?? event.orderId ?? 'manual'}:${order?.orderName ?? event.medicationName}`;
    const lastGiven = lastGivenByMedication.get(key);
    return lastGiven ? eventTimeLabel(lastGiven) : '—';
  };

  const medicationSummaries = useMemo(() => {
    return projectMedicationRows(events, orders, patient, effectiveCaseVersion, categoryFilter, search);
  }, [categoryFilter, effectiveCaseVersion, events, orders, patient, search]);

  const setupBlocked = !actorAvailable || !schemaReady || path === 'unavailable' || (path === 'automatic' && Boolean(assignmentId && (!caseVersion || !baselineReady)));
  const adminContext = hasAdminAccess(profile) && !readOnly;
  const timelineEvents = [...events].sort((a, b) => (a.relativeOffsetHours ?? 0) - (b.relativeOffsetHours ?? 0));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2"><Pill className="h-5 w-5" /> {adminContext ? 'Medication Administration Record' : 'Medications'}</CardTitle>
            {(canEdit || (path === 'manual' && pendingSave && dirty)) && <div className="flex flex-wrap gap-2">{canEdit && <><Button variant="outline" onClick={() => setManualOpen((open) => !open)}><Edit3 className="mr-2 h-4 w-4" />Add medication/event</Button>{path === 'automatic' && <Button variant="outline" onClick={() => setPopulateOpen((open) => !open)}><History className="mr-2 h-4 w-4" />Populate MAR</Button>}</>}<Button onClick={() => void save()} disabled={!dirty}><Save className="mr-2 h-4 w-4" />{pendingSave ? 'Resume frozen save' : `Save ${path === 'manual' ? 'packet' : 'MAR history'}`}</Button></div>}
          </div>
          <p className="text-sm text-muted-foreground">{adminContext ? 'Blank means undocumented. Learner medication orders do not become Given automatically.' : 'Medication history from the authored case. Blank means undocumented.'}</p>
          {setupBlocked && adminContext && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Manual MAR authoring is unavailable until its reviewed packet contract is installed. Opening this view never generates administrations or writes medical orders.</p>}
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
                <Input aria-label="Author confirmed prior hours" value={populate.explicitPriorHours} onChange={(event) => setPopulate((current) => ({ ...current, explicitPriorHours: event.target.value }))} placeholder="Explicit times: 12, 4" />
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
                <Input aria-label="Unit" value={manual.unit} onChange={(event) => setManual((current) => ({ ...current, unit: event.target.value }))} placeholder="Unit" />
                <Input aria-label="Route" value={manual.route} onChange={(event) => setManual((current) => ({ ...current, route: event.target.value }))} placeholder="Route" />
                <Input aria-label="Frequency" value={manual.frequency} onChange={(event) => setManual((current) => ({ ...current, frequency: event.target.value }))} placeholder="Frequency" />
                <Input aria-label="Prior hours" type="number" min="0" max="72" value={manual.relativeOffsetHours} onChange={(event) => setManual((current) => ({ ...current, relativeOffsetHours: event.target.value }))} placeholder="Prior hours" />
                <Select value={manual.category} onValueChange={(value: typeof categories[number]) => setManual((current) => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select>
                <Select value={manual.status} onValueChange={(value: MarStatus) => setManual((current) => ({ ...current, status: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3"><Input aria-label="Reason" value={manual.reason} onChange={(event) => setManual((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason" /><Input aria-label="PRN indication" value={manual.prnIndication} onChange={(event) => setManual((current) => ({ ...current, prnIndication: event.target.value }))} placeholder="PRN indication" /><Input aria-label="PRN response" value={manual.response} onChange={(event) => setManual((current) => ({ ...current, response: event.target.value }))} placeholder="PRN response" /><Input aria-label="Infusion details" value={manual.infusionDetails} onChange={(event) => setManual((current) => ({ ...current, infusionDetails: event.target.value }))} placeholder="Infusion details" /></div>
              <Button onClick={addManual} disabled={!manual.medicationName.trim()}>Add to preview</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search medication" /></div>
            <Select value={historyHours} onValueChange={setHistoryHours}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{['12','24','48','72'].map((hours) => <SelectItem key={hours} value={hours}>{hours} hours</SelectItem>)}</SelectContent></Select>
            <Select value={categoryFilter} onValueChange={(value: 'all' | typeof categories[number]) => setCategoryFilter(value)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All groups</SelectItem>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select>
          </div>
          {schemaReady && error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {saveError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>}
          {previewMessage && <div role="status" className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{previewMessage}</div>}
          {path === 'manual' && !loading && !setupBlocked && <div className="overflow-x-auto rounded-md border bg-muted/10 p-3"><div className="min-w-[980px]"><div className="mb-2 grid grid-cols-[minmax(180px,1fr)_repeat(73,minmax(14px,1fr))] text-[10px] text-muted-foreground"><span className="sticky left-0 bg-muted/10 pr-2">Medication / details</span>{Array.from({ length: 73 }, (_, hour) => <span key={hour} className={`text-center ${[12, 24, 36, 48, 72].includes(hour) ? 'font-bold text-foreground' : ''}`}>{[12, 24, 36, 48, 72].includes(hour) ? `${hour}h` : ''}</span>)}</div>{Array.from(new Set(timelineEvents.map((event) => event.medicationName))).map((medicationName) => { const medicationEvents = timelineEvents.filter((event) => event.medicationName === medicationName); return <div key={medicationName} className="grid grid-cols-[minmax(180px,1fr)_repeat(73,minmax(14px,1fr))] items-center border-t py-2"><div className="pr-2 text-xs"><div className="font-medium">{medicationName}</div><div className="text-muted-foreground">{medicationEvents.map((event) => `${event.administeredDose || event.orderedDose || 'Dose undocumented'} · ${event.route || 'route undocumented'} · ${event.status}`).join(' | ')}</div></div>{Array.from({ length: 73 }, (_, hour) => { const atHour = medicationEvents.filter((event) => event.relativeOffsetHours === hour); const fractional = medicationEvents.filter((event) => event.relativeOffsetHours != null && !Number.isInteger(event.relativeOffsetHours) && Math.floor(event.relativeOffsetHours) === hour); return <div key={hour} className={`relative h-8 border-l ${[12, 24, 36, 48, 72].includes(hour) ? 'border-l-2 border-foreground/40' : 'border-border/40'}`}>{atHour.map((event) => <span key={event.id} title={`${event.relativeOffsetHours}h · ${event.administeredDose || event.orderedDose || 'Dose undocumented'} · ${event.route || 'route undocumented'} · ${event.status}${event.reason ? ` · ${event.reason}` : ''}`} className="absolute left-0.5 top-1 h-6 min-w-2 rounded bg-primary px-0.5 text-[9px] text-primary-foreground">{event.relativeOffsetHours}h</span>)}{fractional.map((event) => <span key={event.id} title={`${event.relativeOffsetHours}h · ${event.administeredDose || event.orderedDose || 'Dose undocumented'} · ${event.route || 'route undocumented'} · ${event.status}${event.reason ? ` · ${event.reason}` : ''}`} style={{ left: `${manualMarTimelineCellOffsetPercent(event.relativeOffsetHours!) }%` }} className="absolute top-1 h-6 -translate-x-1/2 rounded bg-primary px-0.5 text-[9px] text-primary-foreground">{event.relativeOffsetHours}h</span>)}</div>; })}</div>; })}</div></div>}
          {path === 'manual' && !loading && !setupBlocked && timelineEvents.length === 0 && <p role="status" className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{assignmentId ? 'No manual MAR snapshot is attached to this attempt. This view is read-only until a genuinely new assignment is created from a saved author packet.' : 'No manual MAR events have been authored for this case yet.'}</p>}
          {loading ? <div className="rounded-md border p-6 text-sm text-muted-foreground">Loading medication history…</div> : setupBlocked ? <div className="rounded-md border p-6 text-sm text-muted-foreground">{adminContext ? 'Manual MAR authoring will appear after the packet contract is installed.' : 'Medication history is unavailable for this case.'}</div> : medicationSummaries.length === 0 && path !== 'manual' ? <div className="rounded-md border p-6 text-sm text-muted-foreground">No medications documented.</div> : adminContext ? (
            <div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/30 text-left"><th className="p-3">Medication</th><th className="p-3">Ordered dose / route / frequency</th><th className="p-3">Last given</th><th className="p-3">Administration time</th><th className="p-3">Status</th><th className="p-3">Details</th></tr></thead><tbody>{filteredEvents.map((event) => <Fragment key={event.id}><tr className="border-b last:border-0"><td className="p-3 font-medium">{event.medicationName}<div className="text-xs text-muted-foreground">{event.category}{obsoleteKeys.has(event.occurrenceKey) ? ' • obsolete preview occurrence' : ''}</div></td><td className="p-3">{[event.orderedDose, event.unit, event.route, event.frequency].filter(Boolean).join(' • ') || '—'}</td><td className="p-3">{lastGivenLabel(event)}</td><td className="p-3">{eventTimeLabel(event)}</td><td className="p-3"><Select value={event.status} disabled={Boolean(pendingSave)} onValueChange={(value: MarStatus) => updateEvent(event.id, { status: value })}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></td><td className="p-3"><Button size="sm" variant="ghost" disabled={Boolean(pendingSave)} aria-label={`Edit ${event.medicationName}`} onClick={() => beginEdit(event)}><Edit3 className="h-4 w-4" /></Button></td></tr>{editingId === event.id && <tr className="border-b bg-muted/10"><td colSpan={6} className="p-3"><div className="grid grid-cols-1 gap-2 md:grid-cols-4">{(['medicationName','orderedDose','administeredDose','unit','route','frequency','relativeOffsetHours','reason','prnIndication','response','infusionDetails'] as const).map((field) => <Input key={field} disabled={Boolean(pendingSave)} aria-label={field} value={field === 'infusionDetails' ? String((editingDraft.infusionDetails as Record<string, unknown> | null | undefined)?.note ?? '') : String(editingDraft[field] ?? '')} onChange={(e) => setEditingDraft((draft) => ({ ...draft, ...(field === 'infusionDetails' ? { infusionDetails: { note: e.target.value } } : { [field]: field === 'relativeOffsetHours' ? Number(e.target.value) : e.target.value }) }))} placeholder={field} />)}</div><div className="mt-2 flex gap-2"><Button size="sm" disabled={Boolean(pendingSave)} onClick={commitEdit}>Save edit</Button><Button size="sm" variant="outline" disabled={Boolean(pendingSave)} onClick={() => setEditingId(null)}>Cancel</Button></div></td></tr>}</Fragment>)}</tbody></table></div>
          ) : (
            <div className="divide-y rounded-md border">{medicationSummaries.map(({ key, representative, order, administrations }) => { const expanded = expandedMedicationKeys.has(key); const visibleAdministrations = administrations.filter((event) => event.relativeOffsetHours == null || event.relativeOffsetHours <= Number(historyHours)); return <div key={key} className="p-3"><div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"><div className="font-medium">{representative.medicationName}</div><div>{[representative.orderedDose, representative.unit].filter(Boolean).join(' ') || 'Dose undocumented'}</div><div>{representative.route || 'Route undocumented'}</div><div>{representative.frequency || 'Frequency undocumented'}<div className="text-xs text-muted-foreground">Last given: {lastGivenLabel(representative, order)}</div></div><Button size="sm" variant="ghost" onClick={() => setExpandedMedicationKeys((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>{expanded ? 'Hide history' : 'View history'}</Button></div>{expanded && <div className="mt-3 space-y-1 border-l-2 pl-3 text-sm">{administrations.length ? <>{visibleAdministrations.length === 0 && <p className="text-muted-foreground">No doses in the selected {historyHours} hours. Older history remains available by widening the range.</p>}{administrations.map((event) => <div key={event.id} className={`flex flex-wrap gap-x-3 gap-y-1 ${event.relativeOffsetHours != null && event.relativeOffsetHours > Number(historyHours) ? 'text-muted-foreground' : ''}`}><span>{event.status}</span><span>{event.relativeOffsetHours != null ? `${event.relativeOffsetHours} hours prior` : 'During encounter'}</span><span>{event.administeredDose || 'Dose undocumented'}</span>{event.route && <span>{event.route}</span>}{event.reason && <span>{event.reason}</span>}</div>)}</> : <p className="text-muted-foreground">No documented doses.</p>}</div>}</div>; })}</div>
          )}
          {adminContext && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" /> Authored baseline times are shown as prior-hour offsets; real attempt administrations use persisted server times.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
