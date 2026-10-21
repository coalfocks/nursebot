import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Save, Wand2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import type {
  MedicalOrder,
  MarAdministrationEvent,
  MarStatus,
  Patient,
} from "../lib/types";
import { emrApi } from "../lib/api";
import { useAuthStore } from "../../../stores/authStore";
import { hasAdminAccess } from "../../../lib/roles";
import { useRequestIdentity } from "../../../hooks/useRequestIdentity";
import { marScopeKey } from "../lib/marScope";
import {
  authoredEventsToSave,
  buildCaseMarPreview,
  defaultCaseMedicationDraft,
  isRoomScopedAuthoredEvent,
  isRoomScopedAuthoredOrder,
  MAR_HISTORY_OPTIONS,
  mergePreviewWithExisting,
  orderDefinitionFingerprint,
  validateMarDraftOccurrence,
  updatePreviewEvent,
  type CaseMedicationDraft,
  type MarHistoryHours,
} from "../lib/marCaseAuthoring";

const CASE_VERSION = "baseline-v1";
const blankOrder = { name: "", dose: "", route: "", frequency: "" };
const statusOptions: MarStatus[] = [
  "Given",
  "Held",
  "Refused",
  "Not given",
  "Started",
  "Rate changed",
  "Stopped",
  "Not documented",
];
const storageKey = (scopeKey: string, suffix: string) =>
  `case-builder-mar:${scopeKey}:${suffix}`;
const readJson = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => {
  if (typeof window !== "undefined")
    window.localStorage.setItem(key, JSON.stringify(value));
};
const infusionText = (
  details: Record<string, unknown> | null | undefined,
  field: string,
): string => String(details?.[field] ?? "");

type PendingUnknownSave = {
  requestId: string;
  patientId: string;
  roomId: number;
  caseVersion: string;
  expectedRevision: number;
  events: MarAdministrationEvent[];
  actorId: string;
};

export default function CaseBuilderMarAuthoring() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { profile } = useAuthStore();
  const roomId = Number(params.get("roomId"));
  const actorId = profile?.id ?? "anonymous";
  const [patient, setPatient] = useState<Patient | null>(null);
  const [orders, setOrders] = useState<MedicalOrder[]>([]);
  const [events, setEvents] = useState<MarAdministrationEvent[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CaseMedicationDraft>>({});
  const [historyHours, setHistoryHours] = useState<MarHistoryHours>(12);
  const [authoredStayHours, setAuthoredStayHours] = useState(24);
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<
    (ReturnType<typeof buildCaseMarPreview> & { requestId: string }) | null
  >(null);
  const [editing, setEditing] = useState<MedicalOrder | null>(null);
  const [newOrder, setNewOrder] = useState(blankOrder);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [marPersistenceReady, setMarPersistenceReady] = useState(false);
  const [historyReadAvailable, setHistoryReadAvailable] = useState(true);
  const [ordersReadAvailable, setOrdersReadAvailable] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingUnknownSave, setPendingUnknownSave] =
    useState<PendingUnknownSave | null>(null);
  const [durableSaved, setDurableSaved] = useState(false);
  const scopeKey = marScopeKey({
    patientId: patient?.id ?? `room-${roomId}`,
    roomId,
    assignmentId: null,
    caseVersion: CASE_VERSION,
    actorId,
  });
  const { capture, isCurrent } = useRequestIdentity(scopeKey);
  const generationId = useRef<string | null>(null);
  const draftKey = storageKey(scopeKey, "drafts");
  const previewKey = storageKey(scopeKey, "preview");
  const requestKey = storageKey(scopeKey, "generation-request-id");
  const pendingSaveKey = storageKey(scopeKey, "pending-save");
  const editorScopeKey = `${actorId}:${roomId}:${CASE_VERSION}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const captureRef = useRef(capture);
  captureRef.current = capture;

  const ensureGenerationId = useCallback(() => {
    const currentRequestKey = storageKey(
      scopeKeyRef.current,
      "generation-request-id",
    );
    const existing =
      generationId.current ?? readJson<string | null>(currentRequestKey, null);
    if (existing) {
      generationId.current = existing;
      return existing;
    }
    const next = crypto.randomUUID();
    generationId.current = next;
    writeJson(currentRequestKey, next);
    return next;
  }, []);

  const load = useCallback(async () => {
    const request = captureRef.current();
    if (!roomId) {
      setError("A room is required to open Case Builder MAR authoring.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setOrdersReadAvailable(true);
    setHistoryReadAvailable(true);
    setMarPersistenceReady(false);
    setPendingUnknownSave(null);
    setDurableSaved(false);
    let historyReadFailed = false;
    let ordersReadFailed = false;
    const loadedPatient = await emrApi.getPatientByRoomId(roomId);
    if (!isCurrent(request)) return;
    if (!loadedPatient) {
      setError("The authored patient for this room could not be loaded.");
      setLoading(false);
      return;
    }
    const loadedScopeKey = marScopeKey({
      patientId: loadedPatient.id,
      roomId,
      assignmentId: null,
      caseVersion: CASE_VERSION,
      actorId,
    });
    const currentDraftKey = storageKey(loadedScopeKey, "drafts");
    const currentPreviewKey = storageKey(loadedScopeKey, "preview");
    const currentRequestKey = storageKey(
      loadedScopeKey,
      "generation-request-id",
    );
    const currentPendingSaveKey = storageKey(loadedScopeKey, "pending-save");
    const loadedPendingSave = readJson<PendingUnknownSave | null>(
      currentPendingSaveKey,
      null,
    );
    const [loadedOrders, loadedEvents, loadedRevision, roomContext] =
      await Promise.all([
        emrApi.listOrders(loadedPatient.id, undefined, roomId, () => {
          if (!isCurrent(request)) return;
          ordersReadFailed = true;
          setOrdersReadAvailable(false);
        }),
        emrApi.listMarEvents(
          loadedPatient.id,
          undefined,
          roomId,
          CASE_VERSION,
          () => {
            if (!isCurrent(request)) return;
            historyReadFailed = true;
            setHistoryReadAvailable(false);
          },
        ),
        emrApi.getMarHistoryRevision(loadedPatient.id, roomId, null, () => {
          if (!isCurrent(request)) return;
          historyReadFailed = true;
          setHistoryReadAvailable(false);
        }),
        emrApi.getRoomContext(roomId),
      ]);
    if (!isCurrent(request)) return;
    const readiness =
      typeof emrApi.getMarReadiness === "function"
        ? await emrApi.getMarReadiness().catch(() => false)
        : false;
    if (!isCurrent(request)) return;
    setMarPersistenceReady(readiness);
    if (ordersReadFailed) setOrdersReadAvailable(false);
    if (historyReadFailed) setHistoryReadAvailable(false);
    const authoredOrders = loadedOrders.filter((order) =>
      isRoomScopedAuthoredOrder(order, roomId),
    );
    const authoredEvents = loadedEvents.filter((event) =>
      isRoomScopedAuthoredEvent(event, roomId),
    );
    const savedDrafts = readJson<
      Record<string, Partial<CaseMedicationDraft>> & { __historyHours?: string }
    >(currentDraftKey, {});
    const savedPreview = readJson<
      (ReturnType<typeof buildCaseMarPreview> & { requestId?: string }) | null
    >(currentPreviewKey, null);
    const currentOrderFingerprint = orderDefinitionFingerprint(authoredOrders);
    setPatient(loadedPatient);
    setOrders(authoredOrders);
    setEvents(historyReadFailed ? [] : authoredEvents);
    setRevision(loadedRevision);
    setPendingUnknownSave(
      loadedPendingSave &&
        loadedPendingSave.actorId === actorId &&
        loadedPendingSave.patientId === loadedPatient.id
        ? loadedPendingSave
        : null,
    );
    setDurableSaved(authoredEvents.length > 0);
    setAuthoredStayHours(
      Number(roomContext.data?.hospital_stay_days ?? 1) * 24,
    );
    setDrafts(
      Object.fromEntries(
        authoredOrders.map((order) => [
          order.id,
          {
            ...defaultCaseMedicationDraft(order),
            ...(savedDrafts[order.id] ?? {}),
          },
        ]),
      ),
    );
    if (
      savedDrafts.__historyHours &&
      MAR_HISTORY_OPTIONS.includes(
        Number(savedDrafts.__historyHours) as MarHistoryHours,
      )
    ) {
      setHistoryHours(Number(savedDrafts.__historyHours) as MarHistoryHours);
    }
    const savedRequestId = readJson<string | null>(currentRequestKey, null);
    const validSavedPreview =
      savedPreview &&
      savedPreview.orderDefinitionFingerprint === currentOrderFingerprint &&
      savedPreview.requestId === savedRequestId &&
      typeof savedRequestId === "string" &&
      Array.isArray(savedPreview.events) &&
      savedPreview.events.every(
        (event) => typeof event.id === "string" && event.id.length > 0,
      );
    if (validSavedPreview) {
      generationId.current = savedRequestId;
      setPreview({
        ...savedPreview,
        requestId: savedRequestId,
        events: mergePreviewWithExisting(
          savedPreview.events,
          authoredEvents,
          false,
        ),
      });
    } else {
      if (!loadedPendingSave) {
        window.localStorage.removeItem(currentPreviewKey);
        window.localStorage.removeItem(currentRequestKey);
      }
      generationId.current = null;
      setPreview(null);
    }
    setLoading(false);
  }, [actorId, isCurrent, roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPatient(null);
    setOrders([]);
    setEvents([]);
    setDrafts({});
    setPreview(null);
    setEditing(null);
    setNewOrder(blankOrder);
    setPendingUnknownSave(null);
    setDurableSaved(false);
    setSaving(false);
    setLoading(true);
    setError(null);
    setMessage(null);
    generationId.current = null;
  }, [editorScopeKey]);

  useEffect(() => {
    if (!loading)
      writeJson(draftKey, { ...drafts, __historyHours: String(historyHours) });
  }, [draftKey, drafts, historyHours, loading]);

  useEffect(() => {
    if (preview) writeJson(previewKey, preview);
  }, [preview, previewKey]);

  const updateDraft = (
    orderId: string,
    patch: Partial<CaseMedicationDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [orderId]: {
        ...(current[orderId] ??
          defaultCaseMedicationDraft(
            orders.find((order) => order.id === orderId) as MedicalOrder,
          )),
        ...patch,
      },
    }));
    setPreview(null);
    window.localStorage.removeItem(previewKey);
    window.localStorage.removeItem(requestKey);
    generationId.current = null;
  };

  const generatePreview = () => {
    if (!ordersReadAvailable) return;
    const result = buildCaseMarPreview(
      orders,
      drafts,
      historyHours,
      CASE_VERSION,
      authoredStayHours,
    );
    const authoredEvents = events.filter((event) =>
      isRoomScopedAuthoredEvent(event, roomId),
    );
    const requestId = crypto.randomUUID();
    generationId.current = requestId;
    writeJson(requestKey, requestId);
    setPreview({
      ...result,
      requestId,
      events: mergePreviewWithExisting(result.events, authoredEvents).map(
        (event) => ({ ...event, id: event.id ?? crypto.randomUUID() }),
      ),
    });
    setMessage(
      result.errors.length
        ? "Preview has validation errors; nothing was written."
        : "Preview generated locally. Nothing was written.",
    );
  };

  const editPreviewEvent = (
    occurrenceKey: string,
    patch: Partial<ReturnType<typeof buildCaseMarPreview>["events"][number]>,
  ) => {
    const requestId = pendingUnknownSave?.requestId ?? crypto.randomUUID();
    if (!pendingUnknownSave) {
      generationId.current = requestId;
      writeJson(requestKey, requestId);
    }
    setPreview((current) =>
      current
        ? { ...updatePreviewEvent(current, occurrenceKey, patch), requestId }
        : current,
    );
  };

  const savePreview = async () => {
    if (
      !patient ||
      (!preview && !pendingUnknownSave) ||
      (!pendingUnknownSave && Boolean(preview?.errors.length)) ||
      !(preview?.events.length || pendingUnknownSave?.events.length) ||
      saving ||
      !marPersistenceReady ||
      !historyReadAvailable ||
      !ordersReadAvailable
    )
      return;
    const request = capture();
    const submittedRequestId =
      pendingUnknownSave?.requestId ??
      (preview.requestId || ensureGenerationId());
    const submittedEvents = pendingUnknownSave?.events ?? preview!.events;
    const submittedRevision = pendingUnknownSave?.expectedRevision ?? revision;
    setSaving(true);
    setError(null);
    const authoredPreview = submittedEvents.filter(
      (event) =>
        event.source === "authored_scenario" &&
        (!event.orderId || orders.some((order) => order.id === event.orderId)),
    );
    const editedErrors = pendingUnknownSave
      ? []
      : authoredPreview.flatMap((event) =>
          validateMarDraftOccurrence(
            event,
            historyHours,
            authoredStayHours,
          ).map(
            (item) =>
              `${event.medicationName} (${event.occurrenceKey}): ${item}`,
          ),
        );
    if (editedErrors.length) {
      setPreview((current) =>
        current
          ? {
              ...current,
              errors: [
                ...new Set([...(current.baseErrors ?? []), ...editedErrors]),
              ],
            }
          : current,
      );
      setError("Resolve the MAR preview validation errors before saving.");
      setSaving(false);
      return;
    }
    if (!isCurrent(request)) {
      return;
    }
    const authoredExisting = events.filter((event) =>
      isRoomScopedAuthoredEvent(event, roomId),
    );
    const additions =
      pendingUnknownSave?.events ??
      authoredEventsToSave(
        authoredPreview,
        authoredExisting,
        patient.id,
        roomId,
        CASE_VERSION,
        profile?.full_name ?? "Scenario author",
        historyHours,
        authoredStayHours,
      );
    if (!additions.length) {
      setMessage(
        "All preview occurrences already exist. No duplicate administrations were saved.",
      );
      setSaving(false);
      return;
    }
    const result = await emrApi.saveMarHistory(
      patient.id,
      roomId,
      null,
      CASE_VERSION,
      submittedRevision,
      additions,
      submittedRequestId,
    );
    if (!isCurrent(request)) {
      return;
    }
    if (!result.ok) {
      if (result.error.includes("MAR changed in another window")) {
        setError(`${result.error} Reloading the current authored revision.`);
        setSaving(false);
        await load();
        if (!isCurrent(request)) return;
        const reconciledRequestId = crypto.randomUUID();
        generationId.current = reconciledRequestId;
        writeJson(requestKey, reconciledRequestId);
        setPreview((current) =>
          current ? { ...current, requestId: reconciledRequestId } : current,
        );
        setMessage(
          "The saved MAR revision was reconciled. Review the preview and save again as a new request.",
        );
        return;
      }
      const pending = pendingUnknownSave ?? {
        requestId: submittedRequestId,
        patientId: patient.id,
        roomId,
        caseVersion: CASE_VERSION,
        expectedRevision: submittedRevision,
        events: additions,
        actorId,
      };
      setPendingUnknownSave(pending);
      writeJson(pendingSaveKey, pending);
      setError(
        `${result.error} The exact submitted preview is retained for retry.`,
      );
      setSaving(false);
      return;
    }
    window.localStorage.removeItem(requestKey);
    window.localStorage.removeItem(previewKey);
    window.localStorage.removeItem(pendingSaveKey);
    generationId.current = null;
    setPendingUnknownSave(null);
    setPreview(null);
    setDurableSaved(true);
    setRevision(result.revision);
    setMessage(
      `Saved ${additions.length} authored MAR occurrence${additions.length === 1 ? "" : "s"} atomically.`,
    );
    if (!isCurrent(request)) return;
    await load();
    setSaving(false);
  };

  const saveOrder = async (draft: MedicalOrder, isNew: boolean) => {
    if (
      !patient ||
      !draft.orderName.trim() ||
      !marPersistenceReady ||
      !historyReadAvailable ||
      !ordersReadAvailable
    )
      return;
    const request = capture();
    setError(null);
    const saved = isNew
      ? await emrApi.addOrder(
          {
            ...draft,
            id: crypto.randomUUID(),
            patientId: patient.id,
            roomId,
            assignmentId: null,
            overrideScope: "room",
            category: "Medication",
            priority: "Routine",
            status: "Active",
            orderedBy: profile?.full_name ?? "Scenario author",
            orderTime: new Date().toISOString(),
          },
          roomId,
        )
      : await emrApi.updateOrder(
          draft.id,
          {
            orderName: draft.orderName,
            dose: draft.dose,
            route: draft.route,
            frequency: draft.frequency,
          },
          draft.recordVersion,
        );
    if (!isCurrent(request)) return;
    if (!saved || ("conflict" in saved && saved.conflict)) {
      setError(
        "This medication changed elsewhere. Reload before editing it again.",
      );
      return;
    }
    setEditing(null);
    setNewOrder(blankOrder);
    setMessage(
      isNew ? "Authored medication added." : "Authored medication updated.",
    );
    await load();
  };

  const medicationRows = useMemo(
    () =>
      orders.map((order) => ({
        order,
        draft: drafts[order.id] ?? defaultCaseMedicationDraft(order),
      })),
    [drafts, orders],
  );
  const writesDisabled =
    !marPersistenceReady || !historyReadAvailable || !ordersReadAvailable;
  if (!hasAdminAccess(profile))
    return (
      <div className="p-6">
        Case Builder MAR authoring is available to educators only.
      </div>
    );
  if (loading) return <div className="p-6">Loading authored medications…</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button variant="ghost" onClick={() => navigate("/case-builder")}>
              <ArrowLeft className="h-4 w-4" /> Case Builder
            </Button>
            <h1 className="mt-2 text-2xl font-semibold">
              Case Builder MAR setup
            </h1>
            <p className="text-sm text-slate-600">
              Author the simple dose / route / frequency MAR for Room {roomId}.
              Generate MAR Given is a local hypothetical preview; it does not
              claim stored administration history.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">History</label>
            <select
              aria-label="History hours"
              className="rounded-md border bg-white px-3 py-2"
              value={historyHours}
              onChange={(event) => {
                setHistoryHours(Number(event.target.value) as MarHistoryHours);
                setPreview(null);
                window.localStorage.removeItem(previewKey);
                window.localStorage.removeItem(requestKey);
                generationId.current = null;
              }}
            >
              {MAR_HISTORY_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} hours
                </option>
              ))}
            </select>
            <Button disabled={!ordersReadAvailable} onClick={generatePreview}>
              <Wand2 className="h-4 w-4" /> Generate MAR Given
            </Button>
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            {message}
          </div>
        )}
        {pendingUnknownSave && (
          <div
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            An authored MAR save has an unknown outcome. The exact request and
            event envelope are frozen; retry Save authored MAR to reconcile it
            before publishing or starting a new version.
            <Button
              className="ml-2"
              size="sm"
              variant="outline"
              disabled={writesDisabled}
              onClick={() => void savePreview()}
            >
              Retry exact saved MAR
            </Button>
          </div>
        )}
        {durableSaved && !pendingUnknownSave && (
          <div className="flex flex-wrap gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <Button
              variant="outline"
              onClick={() =>
                navigate(
                  `/ehr?roomId=${roomId}&patientId=${patient?.id ?? ""}&tab=mar&marRevision=${revision}`,
                )
              }
            >
              Review saved MAR / publish version
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                navigate(
                  `/admin/assignments?roomId=${roomId}&caseVersion=${encodeURIComponent(CASE_VERSION)}&marRevision=${revision}`,
                )
              }
            >
              Create genuinely new assignment
            </Button>
          </div>
        )}
        {writesDisabled && (
          <div
            role="status"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <strong>Local preview only.</strong>{" "}
            {!ordersReadAvailable
              ? "The authorized medication list is unavailable. "
              : "The authorized medication list is loaded. "}
            {!historyReadAvailable
              ? "Saved MAR history is unavailable, not empty. "
              : ""}
            {!marPersistenceReady
              ? "MAR schema/readiness is unavailable; order edits, save, publication, and assignment handoff are disabled. "
              : ""}
            You can still edit this browser-local draft and generate a
            hypothetical Given preview.
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Authored medications ({orders.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {medicationRows.map(({ order, draft }) => (
                <div key={order.id} className="rounded-md border bg-white p-3">
                  <div className="grid gap-2 md:grid-cols-[1.2fr_.8fr_.6fr_.8fr]">
                    <div>
                      <p className="font-medium">{order.orderName}</p>
                      <p className="text-xs text-slate-500">
                        {order.dose || "Dose not set"} •{" "}
                        {order.route || "Route not set"} •{" "}
                        {order.frequency || "Frequency not set"}
                      </p>
                    </div>
                    <label className="text-xs">
                      Start prior hours
                      <Input
                        aria-label={`${order.orderName} start prior hours`}
                        type="number"
                        min="1"
                        max="72"
                        value={draft.startPriorHours}
                        onChange={(e) =>
                          updateDraft(order.id, {
                            startPriorHours: e.target.value,
                            startPriorHoursEdited: true,
                          })
                        }
                      />
                    </label>
                    <label className="text-xs">
                      Stop prior hours
                      <Input
                        aria-label={`${order.orderName} stop prior hours`}
                        type="number"
                        min="1"
                        max="72"
                        value={draft.stopPriorHours}
                        onChange={(e) =>
                          updateDraft(order.id, {
                            stopPriorHours: e.target.value,
                          })
                        }
                      />
                    </label>
                    <Button
                      variant="outline"
                      className="self-end"
                      disabled={writesDisabled}
                      onClick={() => setEditing(order)}
                    >
                      Edit order
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <label className="text-xs">
                      MAR type
                      <select
                        className="mt-1 h-9 w-full rounded-md border px-2"
                        value={draft.category}
                        onChange={(e) =>
                          updateDraft(order.id, {
                            category: e.target
                              .value as CaseMedicationDraft["category"],
                          })
                        }
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="prn">PRN</option>
                        <option value="one_time">One time</option>
                        <option value="infusion">Infusion</option>
                      </select>
                    </label>
                    <label className="text-xs">
                      BID/TID/QID or PRN times (comma-separated prior hours)
                      <Input
                        value={draft.explicitPriorHours}
                        onChange={(e) =>
                          updateDraft(order.id, {
                            explicitPriorHours: e.target.value,
                          })
                        }
                        placeholder="12, 4"
                      />
                    </label>
                    {draft.category === "prn" && (
                      <label className="flex items-center gap-2 pt-5 text-xs">
                        <input
                          type="checkbox"
                          checked={draft.prnGiven}
                          onChange={(e) =>
                            updateDraft(order.id, {
                              prnGiven: e.target.checked,
                            })
                          }
                        />{" "}
                        Author supplied a Given timing
                      </label>
                    )}
                  </div>
                  {draft.category === "infusion" && (
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <label className="text-xs">
                        Start / rate
                        <Input
                          value={draft.infusionStartPriorHours}
                          onChange={(e) =>
                            updateDraft(order.id, {
                              infusionStartPriorHours: e.target.value,
                            })
                          }
                          placeholder="12"
                        />
                      </label>
                      <label className="text-xs">
                        Rate change / rate
                        <Input
                          value={draft.infusionChangePriorHours}
                          onChange={(e) =>
                            updateDraft(order.id, {
                              infusionChangePriorHours: e.target.value,
                            })
                          }
                          placeholder="6"
                        />
                      </label>
                      <label className="text-xs">
                        Stop / rate
                        <Input
                          value={draft.infusionStopPriorHours}
                          onChange={(e) =>
                            updateDraft(order.id, {
                              infusionStopPriorHours: e.target.value,
                            })
                          }
                          placeholder="2"
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
              {!orders.length && ordersReadAvailable && (
                <p className="text-sm text-slate-600">
                  No authorized authored medications are available.
                </p>
              )}
              <div className="rounded-md border border-dashed p-3">
                <p className="mb-2 text-sm font-medium">
                  Add authored medication
                </p>
                <div className="grid gap-2 md:grid-cols-4">
                  {(["name", "dose", "route", "frequency"] as const).map(
                    (field) => (
                      <Input
                        key={field}
                        aria-label={field}
                        placeholder={field}
                        value={newOrder[field]}
                        disabled={writesDisabled}
                        onChange={(e) =>
                          setNewOrder((current) => ({
                            ...current,
                            [field]: e.target.value,
                          }))
                        }
                      />
                    ),
                  )}
                </div>
                <Button
                  className="mt-2"
                  size="sm"
                  disabled={writesDisabled}
                  onClick={() =>
                    void saveOrder(
                      {
                        id: "",
                        patientId: patient?.id ?? "",
                        orderName: newOrder.name,
                        dose: newOrder.dose,
                        route: newOrder.route,
                        frequency: newOrder.frequency,
                        category: "Medication",
                        priority: "Routine",
                        status: "Active",
                        orderedBy: profile?.full_name ?? "Scenario author",
                        orderTime: new Date().toISOString(),
                      },
                      true,
                    )
                  }
                >
                  <Plus className="h-4 w-4" /> Add medication
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Generated Given preview</CardTitle>
            </CardHeader>
            <CardContent>
              {!preview ? (
                <p className="text-sm text-slate-600">
                  Choose timings, then Generate MAR Given. This panel is the
                  complete preview shown before Save.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-slate-500">
                    {preview.events.length} rows • {historyHours}-hour history
                    {preview.errors.length
                      ? " • resolve validation errors before saving"
                      : " • no 0-hour events"}
                  </p>
                  {preview.errors.length > 0 && (
                    <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                      {preview.errors.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  )}
                  <div className="max-h-[32rem] overflow-auto rounded-md border">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-slate-100">
                        <tr>
                          <th className="p-2">Medication</th>
                          <th className="p-2">Dose</th>
                          <th className="p-2">Prior hours</th>
                          <th className="p-2">Status</th>
                          <th className="p-2">Reason / infusion details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.events.map((event) => (
                          <tr
                            key={event.occurrenceKey}
                            className="border-t align-top"
                          >
                            <td className="p-2">
                              {event.medicationName}
                              <div className="text-xs text-slate-500">
                                {[event.route, event.frequency]
                                  .filter(Boolean)
                                  .join(" • ")}
                              </div>
                            </td>
                            <td className="p-2">
                              <Input
                                aria-label={`${event.occurrenceKey} dose`}
                                value={event.orderedDose ?? ""}
                                onChange={(e) =>
                                  editPreviewEvent(event.occurrenceKey, {
                                    orderedDose: e.target.value,
                                    administeredDose: e.target.value,
                                  })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                aria-label={`${event.occurrenceKey} time`}
                                type="number"
                                min="1"
                                max="72"
                                value={event.relativeOffsetHours}
                                onChange={(e) =>
                                  editPreviewEvent(event.occurrenceKey, {
                                    relativeOffsetHours: Number(e.target.value),
                                  })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <select
                                aria-label={`${event.occurrenceKey} status`}
                                className="h-9 rounded-md border px-2"
                                value={event.status}
                                onChange={(e) =>
                                  editPreviewEvent(event.occurrenceKey, {
                                    status: e.target.value as MarStatus,
                                  })
                                }
                              >
                                {statusOptions.map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2">
                              <Input
                                aria-label={`${event.occurrenceKey} reason`}
                                value={event.reason ?? ""}
                                placeholder="Reason"
                                onChange={(e) =>
                                  editPreviewEvent(event.occurrenceKey, {
                                    reason: e.target.value,
                                  })
                                }
                              />
                              {event.category === "infusion" && (
                                <div className="mt-1 space-y-1">
                                  <Input
                                    aria-label={`${event.occurrenceKey} infusion rate`}
                                    value={infusionText(
                                      event.infusionDetails,
                                      "rate",
                                    )}
                                    placeholder="Rate"
                                    onChange={(e) =>
                                      editPreviewEvent(event.occurrenceKey, {
                                        infusionDetails: {
                                          ...(event.infusionDetails ?? {}),
                                          rate: e.target.value,
                                        },
                                      })
                                    }
                                  />
                                  <Input
                                    aria-label={`${event.occurrenceKey} infusion volume`}
                                    value={infusionText(
                                      event.infusionDetails,
                                      "volume",
                                    )}
                                    placeholder="Volume"
                                    onChange={(e) =>
                                      editPreviewEvent(event.occurrenceKey, {
                                        infusionDetails: {
                                          ...(event.infusionDetails ?? {}),
                                          volume: e.target.value,
                                        },
                                      })
                                    }
                                  />
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    className="mt-3 w-full"
                    disabled={
                      writesDisabled ||
                      (!pendingUnknownSave && Boolean(preview.errors.length)) ||
                      !preview.events.length ||
                      saving
                    }
                    onClick={() => void savePreview()}
                  >
                    <Save className="h-4 w-4" /> Save authored MAR
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold">
                Edit authored medication
              </h2>
              <div className="mt-3 grid gap-3">
                {(["orderName", "dose", "route", "frequency"] as const).map(
                  (field) => (
                    <label key={field} className="text-sm">
                      {field}
                      <Input
                        value={editing[field] ?? ""}
                        onChange={(e) =>
                          setEditing((current) =>
                            current
                              ? { ...current, [field]: e.target.value }
                              : current,
                          )
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={writesDisabled}
                  onClick={() => void saveOrder(editing, false)}
                >
                  Save edit
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
