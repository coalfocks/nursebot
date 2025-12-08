import type { ClinicalNote, LabResult, Patient, VitalSigns } from './types';

export type LabGenerationContext = {
  patient?: Patient;
  assignmentId?: string | null;
  roomId?: number | null;
  orderName?: string;
  previousLabs?: LabResult[];
  clinicalNotes?: ClinicalNote[];
  vitals?: VitalSigns[];
};

type LabTemplate = {
  testName: string;
  unit: string;
  referenceRange: string;
  normal: [number, number];
};

const labTemplates: LabTemplate[] = [
  { testName: 'Hemoglobin', unit: 'g/dL', referenceRange: '12.0-15.5', normal: [12, 15.5] },
  { testName: 'White Blood Cell Count', unit: 'K/uL', referenceRange: '4.0-11.0', normal: [4, 11] },
  { testName: 'Platelets', unit: 'K/uL', referenceRange: '150-450', normal: [150, 450] },
  { testName: 'Creatinine', unit: 'mg/dL', referenceRange: '0.7-1.3', normal: [0.7, 1.3] },
  { testName: 'Sodium', unit: 'mmol/L', referenceRange: '135-145', normal: [135, 145] },
  { testName: 'Potassium', unit: 'mmol/L', referenceRange: '3.5-5.0', normal: [3.5, 5] },
];

const randomInRange = (min: number, max: number) => Number((Math.random() * (max - min) + min).toFixed(1));

const deriveLabStatus = (value: number, [low, high]: [number, number]) => {
  if (value < low * 0.9 || value > high * 1.1) {
    return 'Critical';
  }
  if (value < low || value > high) {
    return 'Abnormal';
  }
  return 'Normal';
};

type ClinicalSignals = {
  emphasis: 'Normal' | 'Abnormal' | 'Critical';
  infectionHints: boolean;
  bleedingHints: boolean;
  anemiaHints: boolean;
  renalHints: boolean;
  dehydrationHints: boolean;
  oxygenationHints: boolean;
  latestLabValues: Record<string, number>;
};

const normalizeLabValue = (value: string | number): number | null => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const deriveClinicalSignals = (caseDescription: string, context?: LabGenerationContext): ClinicalSignals => {
  const previousLabs = context?.previousLabs ?? [];
  const vitals = context?.vitals ?? [];
  const notes = context?.clinicalNotes ?? [];

  const latestLabValuesWithTimestamps = previousLabs.reduce<Record<string, { value: number; timestamp: number }>>((acc, lab) => {
    const value = normalizeLabValue(lab.value);
    if (value === null) return acc;
    const timestamp = new Date(lab.collectionTime ?? lab.resultTime ?? '').getTime() || 0;
    const current = acc[lab.testName];
    if (!current || timestamp > current.timestamp) {
      acc[lab.testName] = { value, timestamp };
    }
    return acc;
  }, {});
  const latestLabValues = Object.fromEntries(
    Object.entries(latestLabValuesWithTimestamps).map(([key, entry]) => [key, entry.value]),
  );

  const corpus = [
    caseDescription,
    context?.orderName ?? '',
    notes.map((note) => `${note.title} ${note.content}`).join(' '),
  ]
    .join(' ')
    .toLowerCase();

  const fever = vitals.some((v) => (v.temperature ?? 0) >= 100.4);
  const tachycardia = vitals.some((v) => (v.heartRate ?? 0) >= 110);
  const hypotension = vitals.some((v) => (v.bloodPressureSystolic ?? 0) <= 100);
  const hypoxia = vitals.some((v) => (v.oxygenSaturation ?? 100) < 93);

  const infectionHints =
    fever ||
    hypoxia ||
    ['infection', 'sepsis', 'pneumonia', 'uti', 'abscess', 'fever', 'cough', 'sputum'].some((keyword) =>
      corpus.includes(keyword),
    );
  const bleedingHints = ['bleed', 'hematemesis', 'melena', 'anemia', 'blood loss'].some((keyword) =>
    corpus.includes(keyword),
  );
  const renalHints =
    ['renal', 'kidney', 'aki', 'ckd', 'creatinine'].some((keyword) => corpus.includes(keyword)) ||
    (typeof latestLabValues.Creatinine === 'number' && latestLabValues.Creatinine > 1.3);
  const dehydrationHints =
    ['dehydration', 'vomiting', 'diarrhea', 'poor intake'].some((keyword) => corpus.includes(keyword)) ||
    (tachycardia && hypotension);
  const anemiaHints =
    bleedingHints ||
    (typeof latestLabValues.Hemoglobin === 'number' && latestLabValues.Hemoglobin < 11) ||
    corpus.includes('fatigue');

  const abnormalLabs = previousLabs.filter((lab) => lab.status === 'Abnormal').length;
  const criticalLabs = previousLabs.filter((lab) => lab.status === 'Critical').length;

  let riskScore = 0;
  if (infectionHints) riskScore += 2;
  if (bleedingHints || anemiaHints) riskScore += 1;
  if (renalHints) riskScore += 1;
  if (dehydrationHints) riskScore += 1;
  if (hypoxia) riskScore += 1;
  if (tachycardia) riskScore += 0.5;
  riskScore += abnormalLabs * 0.5 + criticalLabs;

  const emphasis: ClinicalSignals['emphasis'] = riskScore >= 5 ? 'Critical' : riskScore >= 2 ? 'Abnormal' : 'Normal';

  return {
    emphasis,
    infectionHints,
    bleedingHints,
    anemiaHints,
    renalHints,
    dehydrationHints,
    oxygenationHints: hypoxia,
    latestLabValues,
  };
};

const applyClinicalBias = (template: LabTemplate, value: number, signals: ClinicalSignals) => {
  const [low, high] = template.normal;
  const range = high - low;

  if (template.testName === 'White Blood Cell Count' && signals.infectionHints) {
    const target = high + range * (signals.emphasis === 'Critical' ? 0.6 : 0.3);
    value = Math.max(value, target + randomInRange(-range * 0.1, range * 0.1));
  }

  if (template.testName === 'Hemoglobin' && signals.anemiaHints) {
    const target = low - range * (signals.emphasis === 'Critical' ? 0.35 : 0.2);
    value = Math.min(value, target + randomInRange(-range * 0.05, range * 0.05));
  }

  if (template.testName === 'Platelets' && signals.bleedingHints) {
    const drop = range * (signals.emphasis === 'Critical' ? 0.45 : 0.25);
    value = Math.min(value, high - drop + randomInRange(-range * 0.05, range * 0.05));
  }

  if (template.testName === 'Creatinine' && (signals.renalHints || signals.dehydrationHints)) {
    const bump = range * (signals.emphasis === 'Critical' ? 0.6 : 0.35);
    value = Math.max(value, high + bump + randomInRange(-0.1, 0.1));
  }

  if (template.testName === 'Sodium' && signals.dehydrationHints) {
    value = Math.max(value, high + range * 0.2 + randomInRange(-0.5, 0.5));
  }

  if (template.testName === 'Potassium' && signals.renalHints) {
    value = Math.max(value, high + range * 0.15 + randomInRange(-0.3, 0.3));
  }

  return Number(Math.max(value, 0).toFixed(1));
};

export async function generateLabResults(
  patientId: string,
  caseDescription: string,
  context?: LabGenerationContext,
): Promise<LabResult[]> {
  const signals = deriveClinicalSignals(caseDescription, context);

  const results = labTemplates.map((template, index) => {
    const [low, high] = template.normal;
    const priorValue = signals.latestLabValues[template.testName];
    const base = typeof priorValue === 'number' ? priorValue : randomInRange(low, high);
    const variance = signals.emphasis === 'Critical' ? 0.3 : signals.emphasis === 'Abnormal' ? 0.18 : 0.08;
    const drifted = base * (1 + randomInRange(-variance, variance));
    const biasedValue = applyClinicalBias(template, drifted, signals);
    const status = emphasizeStatus(deriveLabStatus(biasedValue, template.normal), signals.emphasis);

    return {
      id: `generated-lab-${Date.now()}-${index}`,
      patientId,
      testName: template.testName,
      value: biasedValue,
      unit: template.unit,
      referenceRange: template.referenceRange,
      status,
      collectionTime: new Date().toISOString(),
      resultTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      orderedBy: 'Automated Suggestion',
    } as LabResult;
  });

  return Promise.resolve(results);
}

const emphasizeStatus = (status: LabResult['status'], emphasis: string): LabResult['status'] => {
  if (emphasis === 'Abnormal' && status === 'Normal') {
    return 'Abnormal';
  }
  return status;
};

export async function generateVitalSigns(patientId: string, caseDescription: string): Promise<VitalSigns[]> {
  const baseTemp = caseDescription.toLowerCase().includes('fever') ? 100 : 98.4;
  const entries = Array.from({ length: 6 }).map((_, index) => {
    const offsetHours = index * 4;
    const timestamp = new Date(Date.now() - offsetHours * 60 * 60 * 1000).toISOString();
    return {
      id: `generated-vital-${Date.now()}-${index}`,
      patientId,
      timestamp,
      temperature: Number((baseTemp + randomInRange(-0.6, 0.8)).toFixed(1)),
      bloodPressureSystolic: Math.round(120 + randomInRange(-10, 12)),
      bloodPressureDiastolic: Math.round(78 + randomInRange(-8, 10)),
      heartRate: Math.round(80 + randomInRange(-12, 18)),
      respiratoryRate: Math.round(16 + randomInRange(-3, 4)),
      oxygenSaturation: Math.round(97 + randomInRange(-3, 1)),
      pain: Math.max(0, Math.min(10, Math.round(3 + randomInRange(-1, 2)))),
    } as VitalSigns;
  });

  return Promise.resolve(entries);
}
