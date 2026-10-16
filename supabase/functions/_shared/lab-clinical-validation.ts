type LabValue = string | number | null | undefined;

type LabContext = {
  assignmentId?: string | null;
  orderName?: string | null;
  caseInstructions?: string | null;
  nurseContext?: string | null;
  expectedDiagnosis?: string | null;
  expectedTreatment?: string[] | null;
  caseGoals?: string | null;
  objective?: string | null;
  emrContext?: unknown;
  previousLabs?: Array<{ testName?: string; value?: LabValue; assignmentId?: string | null }>;
};

const key = (value: string) => value.toLowerCase().replace(/[()]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

const numberFor = (rows: Record<string, unknown>[], names: string[]) => {
  const wanted = new Set(names.map(key));
  const row = rows.find((entry) => wanted.has(key(typeof entry.testName === 'string' ? entry.testName : '')));
  if (!row) return null;
  const value = typeof row.value === 'number' ? row.value : Number(row.value);
  return Number.isFinite(value) ? value : null;
};

const contextText = (context?: LabContext) => [
  context?.caseInstructions,
  context?.nurseContext,
  context?.expectedDiagnosis,
  ...(context?.expectedTreatment ?? []),
  context?.caseGoals,
  context?.objective,
  context?.orderName,
  typeof context?.emrContext === 'string' ? context.emrContext : JSON.stringify(context?.emrContext ?? ''),
].filter(Boolean).join(' ').toLowerCase();

export const validateClinicalLabPanel = (
  rows: Record<string, unknown>[],
  context?: LabContext,
): { ok: true } | { ok: false; reason: string } => {
  const text = contextText(context);
  const dkaLike = /\bdka\b|diabetic ketoacidosis|kussmaul|deep\s+(?:and\s+)?rapid\s+breath|insulin\s+(?:was\s+)?omitted|glucose\s*[:=]?\s*[2-9]\d\d/.test(text);

  if (dkaLike) {
    const glucose = numberFor(rows, ['Glucose']);
    const ketones = numberFor(rows, ['Beta-Hydroxybutyrate']);
    const bicarbonate = numberFor(rows, ['CO2 (Bicarbonate)', 'HCO3 (Arterial)', 'HCO3 (Venous)']);
    const ph = numberFor(rows, ['pH (Arterial)', 'pH (Venous)']);
    if (glucose !== null && glucose < 250) return { ok: false, reason: 'case glucose is inconsistent with the authored hyperglycemic scenario' };
    if (ketones !== null && ketones < 3) return { ok: false, reason: 'ketones are inconsistent with the authored DKA scenario' };
    if (bicarbonate !== null && bicarbonate > 18) return { ok: false, reason: 'bicarbonate is inconsistent with the authored metabolic acidosis' };
    if (ph !== null && ph > 7.3) return { ok: false, reason: 'pH is inconsistent with the authored metabolic acidosis' };
    const sodium = numberFor(rows, ['Sodium']);
    const chloride = numberFor(rows, ['Chloride']);
    if (sodium !== null && chloride !== null && bicarbonate !== null && sodium - chloride - bicarbonate < 12) {
      return { ok: false, reason: 'anion gap is inconsistent with the authored DKA scenario' };
    }
  }

  const ph = numberFor(rows, ['pH (Arterial)', 'pH (Venous)']);
  const pco2 = numberFor(rows, ['PaCO2', 'pCO2 (Venous)']);
  const bicarbonate = numberFor(rows, ['HCO3 (Arterial)', 'HCO3 (Venous)']);
  if (ph !== null && pco2 !== null && bicarbonate !== null && pco2 > 0 && bicarbonate > 0) {
    const expectedPh = 6.1 + Math.log10(bicarbonate / (0.03 * pco2));
    if (Math.abs(expectedPh - ph) > 0.15) return { ok: false, reason: 'acid-base values are internally inconsistent' };
  }

  const glucoseRows = rows
    .filter((entry) => /glucose/i.test(typeof entry.testName === 'string' ? entry.testName : ''))
    .map((entry) => typeof entry.value === 'number' ? entry.value : Number(entry.value))
    .filter(Number.isFinite);
  if (glucoseRows.length > 1 && Math.max(...glucoseRows) - Math.min(...glucoseRows) > 5) {
    return { ok: false, reason: 'glucose values disagree across the ordered panel' };
  }
  if (context?.assignmentId) {
    const priorAssignmentGlucose = (context.previousLabs ?? [])
      .filter((entry) => entry.assignmentId === context.assignmentId && /glucose/i.test(entry.testName ?? ''))
      .map((entry) => typeof entry.value === 'number' ? entry.value : Number(entry.value))
      .filter(Number.isFinite);
    if (priorAssignmentGlucose.length && glucoseRows.length) {
      const latest = priorAssignmentGlucose[priorAssignmentGlucose.length - 1];
      if (glucoseRows.some((value) => Math.abs(value - latest) > 5)) {
        return { ok: false, reason: 'glucose disagrees with the active assignment result' };
      }
    }
  }
  return { ok: true };
};
