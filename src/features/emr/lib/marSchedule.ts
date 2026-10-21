export type MarCategory = "scheduled" | "prn" | "one_time" | "infusion";
export type MarStatus =
  | "Given"
  | "Held"
  | "Refused"
  | "Not given"
  | "Started"
  | "Rate changed"
  | "Stopped"
  | "Not documented";

export interface MarDraftOccurrence {
  id?: string;
  occurrenceKey: string;
  relativeOffsetHours: number;
  administeredAt?: string | null;
  medicationName: string;
  orderedDose?: string;
  administeredDose?: string;
  unit?: string;
  route?: string;
  frequency?: string;
  category: MarCategory;
  status: MarStatus;
  simulatedClinician?: string;
  reason?: string;
  prnIndication?: string;
  response?: string;
  infusionDetails?: Record<string, unknown> | null;
  orderId?: string | null;
  caseVersion?: string | null;
  source?: "authored_scenario" | "simulation" | "learner";
}

export interface MarScheduleInput {
  medicationName: string;
  orderId?: string | null;
  orderedDose?: string;
  unit?: string;
  route?: string;
  frequency: string;
  category?: MarCategory;
  historyHours: number;
  /** Authored encounter/admission duration, capped at 72h. */
  stayHours?: number;
  /** Medication-specific start offset; older callers may use firstDosePriorHours. */
  startPriorHours?: number;
  firstDosePriorHours: number;
  assumePrnGiven?: boolean;
  stopPriorHours?: number | null;
  /** Author-confirmed occurrence offsets for BID/TID/QID or explicit PRN times. */
  explicitPriorHours?: number[];
  caseVersion?: string | null;
  infusionEvents?: Array<{
    offsetHours: number;
    status: Extract<MarStatus, "Started" | "Rate changed" | "Stopped">;
    rate?: string;
    volume?: string;
  }>;
}

const frequencyHours = (frequency: string): number | null => {
  // Orders commonly preserve the clinical qualifier in the frequency field
  // (for example, "q6h PRN" or "q2 hr PRN"). Parse the interval token while
  // retaining the original frequency on each authored occurrence. Do not
  // accept ranges such as q4-6h: they still require authored times.
  const normalized = frequency.trim().toLowerCase().replace(/\s+/g, "");
  const qHours = normalized.match(
    /^q(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours)(?:prn)?$/,
  );
  if (qHours) return Number(qHours[1]);
  if (normalized === "daily") return 24;
  if (normalized === "bid") return 12;
  if (normalized === "tid") return 8;
  if (normalized === "qid") return 6;
  if (normalized === "qhs" || normalized === "nightly") return 24;
  return null;
};

const finiteHours = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`MAR_INVALID_${label.toUpperCase()}`);
  return value;
};

const normalizeHistoryHours = (input: MarScheduleInput): number => {
  const history = finiteHours(input.historyHours, "history_hours");
  const stay = finiteHours(input.stayHours ?? history, "stay_hours");
  if (history > 72 || stay > 72)
    throw new RangeError("MAR_HISTORY_EXCEEDS_MAXIMUM");
  if (history > stay) throw new RangeError("MAR_INCOMPATIBLE_SOURCE_STAY");
  return history;
};

const explicitOffsets = (
  input: MarScheduleInput,
  historyHours: number,
  first: number,
  stop: number | null,
): number[] => {
  const values = input.explicitPriorHours ?? [];
  if (!values.length) throw new RangeError("MAR_EXPLICIT_TIMES_REQUIRED");
  const offsets = values.map((value) => finiteHours(value, "explicit_time"));
  if (offsets.some((value) => value <= 0))
    throw new RangeError("MAR_TIME_MUST_PRECEDE_FIRST_PAGE");
  if (offsets.some((value) => value > historyHours))
    throw new RangeError("MAR_TIME_OUTSIDE_STAY");
  if (offsets.some((value) => stop !== null && value < stop))
    throw new RangeError("MAR_TIME_AFTER_STOP");
  if (offsets.some((value) => value > first))
    throw new RangeError("MAR_TIME_BEFORE_START");
  return [...new Set(offsets)].sort((a, b) => b - a);
};

export const expandMarSchedule = (
  input: MarScheduleInput,
): MarDraftOccurrence[] => {
  const historyHours = normalizeHistoryHours(input);
  const requestedFirst = input.startPriorHours ?? input.firstDosePriorHours;
  finiteHours(requestedFirst, "start_hours");
  if (requestedFirst > historyHours)
    throw new RangeError("MAR_START_OUTSIDE_STAY");
  const first = requestedFirst;
  if (input.stopPriorHours !== null && input.stopPriorHours !== undefined)
    finiteHours(input.stopPriorHours, "stop_hours");
  const stop =
    input.stopPriorHours === null || input.stopPriorHours === undefined
      ? null
      : input.stopPriorHours;
  if (stop !== null && stop > first)
    throw new RangeError("MAR_STOP_BEFORE_START");
  if (stop !== null && stop <= 0)
    throw new RangeError("MAR_STOP_MUST_PRECEDE_FIRST_PAGE");
  const category = input.category ?? "scheduled";
  if (first === 0) {
    throw new RangeError("MAR_ZERO_HOUR_BASELINE");
  }
  if (category === "prn") {
    if (!input.assumePrnGiven) return [];
    const normalizedFrequency = input.frequency.trim().toLowerCase();
    const requiresExplicit = ["bid", "tid", "qid"].includes(
      normalizedFrequency,
    );
    const interval = requiresExplicit ? null : frequencyHours(input.frequency);
    const offsets = interval
      ? Array.from(
          { length: Math.floor((first - (stop ?? 0)) / interval) + 1 },
          (_, index) => first - index * interval,
        ).filter((offset) => offset > 0 && (stop === null || offset >= stop))
      : explicitOffsets(input, historyHours, first, stop);
    return offsets.map((offset) => ({
      occurrenceKey: `${input.orderId ?? input.medicationName}:prn:${offset}`,
      relativeOffsetHours: offset,
      medicationName: input.medicationName,
      orderId: input.orderId,
      orderedDose: input.orderedDose,
      administeredDose: input.orderedDose,
      unit: input.unit,
      route: input.route,
      frequency: input.frequency,
      category,
      status: "Given" as const,
      caseVersion: input.caseVersion,
      source: "authored_scenario" as const,
    }));
  }
  if (category === "one_time" || /^once$/i.test(input.frequency.trim())) {
    return [
      {
        occurrenceKey: `${input.orderId ?? input.medicationName}:once:${first}`,
        relativeOffsetHours: first,
        medicationName: input.medicationName,
        orderId: input.orderId,
        orderedDose: input.orderedDose,
        administeredDose: input.orderedDose,
        unit: input.unit,
        route: input.route,
        frequency: input.frequency,
        category: "one_time",
        status: "Given",
        caseVersion: input.caseVersion,
        source: "authored_scenario",
      },
    ];
  }
  if (category === "infusion") {
    const infusionEvents = input.infusionEvents ?? [];
    const normalizedEvents = infusionEvents.map((event) => ({
      ...event,
      offsetHours: finiteHours(event.offsetHours, "infusion_time"),
    }));
    if (normalizedEvents.some((event) => event.offsetHours > historyHours))
      throw new RangeError("MAR_TIME_OUTSIDE_STAY");
    const orderedEvents = [...normalizedEvents].sort(
      (a, b) => b.offsetHours - a.offsetHours,
    );
    if (orderedEvents.some((event) => event.offsetHours === 0))
      throw new RangeError("MAR_ZERO_HOUR_BASELINE");
    const chronologicalEvents = [...normalizedEvents].sort(
      (a, b) => b.offsetHours - a.offsetHours,
    );
    const starts = chronologicalEvents.filter(
      (event) => event.status === "Started",
    );
    const stops = chronologicalEvents.filter(
      (event) => event.status === "Stopped",
    );
    if (starts.length !== 1 || stops.length > 1)
      throw new RangeError("MAR_INFUSION_START_STOP_CONFLICT");
    const startIndex = chronologicalEvents.findIndex(
      (event) => event.status === "Started",
    );
    const stopIndex = chronologicalEvents.findIndex(
      (event) => event.status === "Stopped",
    );
    if (startIndex < 0 || (stopIndex >= 0 && stopIndex < startIndex))
      throw new RangeError("MAR_INFUSION_START_STOP_CONFLICT");
    if (
      chronologicalEvents.some(
        (event, index) =>
          event.status === "Rate changed" &&
          (index < startIndex || (stopIndex >= 0 && index > stopIndex)),
      )
    ) {
      throw new RangeError("MAR_INFUSION_RATE_CHANGE_CONFLICT");
    }
    if (orderedEvents.filter((event) => event.status === "Started").length > 1)
      throw new RangeError("MAR_DUPLICATE_INFUSION_START");
    return orderedEvents.map((event) => ({
      occurrenceKey: `${input.orderId ?? input.medicationName}:infusion:${event.status}:${event.offsetHours}`,
      relativeOffsetHours: event.offsetHours,
      medicationName: input.medicationName,
      orderId: input.orderId,
      orderedDose: input.orderedDose,
      administeredDose: input.orderedDose,
      unit: input.unit,
      route: input.route,
      frequency: input.frequency,
      category,
      status: event.status,
      infusionDetails: { rate: event.rate, volume: event.volume },
      caseVersion: input.caseVersion,
      source: "authored_scenario" as const,
    }));
  }
  const normalizedFrequency = input.frequency
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const interval = frequencyHours(input.frequency);
  if (!interval || interval <= 0)
    throw new RangeError("MAR_UNSUPPORTED_FREQUENCY");
  const requiresExplicit = ["bid", "tid", "qid"].includes(normalizedFrequency);
  if (requiresExplicit) {
    return explicitOffsets(input, historyHours, first, stop).map((offset) => ({
      occurrenceKey: `${input.orderId ?? input.medicationName}:scheduled:${offset}`,
      relativeOffsetHours: offset,
      medicationName: input.medicationName,
      orderId: input.orderId,
      orderedDose: input.orderedDose,
      administeredDose: input.orderedDose,
      unit: input.unit,
      route: input.route,
      frequency: input.frequency,
      category: "scheduled" as const,
      status: "Given" as const,
      caseVersion: input.caseVersion,
      source: "authored_scenario" as const,
    }));
  }
  const occurrences: MarDraftOccurrence[] = [];
  const effectiveStop = stop ?? 0;
  for (
    let offset = first;
    offset >= effectiveStop && offset <= historyHours;
    offset -= interval
  ) {
    if (offset <= 0) continue;
    occurrences.push({
      occurrenceKey: `${input.orderId ?? input.medicationName}:scheduled:${offset}`,
      relativeOffsetHours: offset,
      medicationName: input.medicationName,
      orderId: input.orderId,
      orderedDose: input.orderedDose,
      administeredDose: input.orderedDose,
      unit: input.unit,
      route: input.route,
      frequency: input.frequency,
      category: "scheduled",
      status: "Given",
      caseVersion: input.caseVersion,
      source: "authored_scenario",
    });
  }
  return occurrences;
};
