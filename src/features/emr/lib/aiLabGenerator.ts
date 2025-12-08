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
  // Hematology
  { testName: 'Hemoglobin', unit: 'g/dL', referenceRange: '12.0-15.5', normal: [12, 15.5] },
  { testName: 'Hematocrit', unit: '%', referenceRange: '36-46', normal: [36, 46] },
  { testName: 'White Blood Cell Count', unit: 'K/uL', referenceRange: '4.0-11.0', normal: [4, 11] },
  { testName: 'Neutrophils %', unit: '%', referenceRange: '40-70', normal: [40, 70] },
  { testName: 'Lymphocytes %', unit: '%', referenceRange: '20-40', normal: [20, 40] },
  { testName: 'Platelets', unit: 'K/uL', referenceRange: '150-450', normal: [150, 450] },

  // Basic/Chemistry
  { testName: 'Sodium', unit: 'mmol/L', referenceRange: '135-145', normal: [135, 145] },
  { testName: 'Potassium', unit: 'mmol/L', referenceRange: '3.5-5.0', normal: [3.5, 5] },
  { testName: 'Chloride', unit: 'mmol/L', referenceRange: '98-107', normal: [98, 107] },
  { testName: 'CO2 (Bicarbonate)', unit: 'mmol/L', referenceRange: '22-29', normal: [22, 29] },
  { testName: 'BUN', unit: 'mg/dL', referenceRange: '7-20', normal: [7, 20] },
  { testName: 'Creatinine', unit: 'mg/dL', referenceRange: '0.7-1.3', normal: [0.7, 1.3] },
  { testName: 'Glucose', unit: 'mg/dL', referenceRange: '70-100', normal: [70, 100] },
  { testName: 'Calcium', unit: 'mg/dL', referenceRange: '8.5-10.5', normal: [8.5, 10.5] },
  { testName: 'Ionized Calcium', unit: 'mmol/L', referenceRange: '1.05-1.35', normal: [1.05, 1.35] },
  { testName: 'Magnesium', unit: 'mg/dL', referenceRange: '1.7-2.4', normal: [1.7, 2.4] },
  { testName: 'Phosphorus', unit: 'mg/dL', referenceRange: '2.5-4.5', normal: [2.5, 4.5] },

  // Liver
  { testName: 'AST', unit: 'U/L', referenceRange: '10-40', normal: [10, 40] },
  { testName: 'ALT', unit: 'U/L', referenceRange: '7-56', normal: [7, 56] },
  { testName: 'Alkaline Phosphatase', unit: 'U/L', referenceRange: '40-130', normal: [40, 130] },
  { testName: 'Total Bilirubin', unit: 'mg/dL', referenceRange: '0.3-1.2', normal: [0.3, 1.2] },
  { testName: 'Albumin', unit: 'g/dL', referenceRange: '3.5-5.0', normal: [3.5, 5] },

  // Coagulation
  { testName: 'PT', unit: 'seconds', referenceRange: '11-13.5', normal: [11, 13.5] },
  { testName: 'INR', unit: '', referenceRange: '0.8-1.2', normal: [0.8, 1.2] },
  { testName: 'aPTT', unit: 'seconds', referenceRange: '25-35', normal: [25, 35] },
  { testName: 'Fibrinogen', unit: 'mg/dL', referenceRange: '200-400', normal: [200, 400] },
  { testName: 'D-dimer', unit: 'mcg/mL FEU', referenceRange: '0.00-0.50', normal: [0, 0.5] },

  // Cardio/pulmonary
  { testName: 'pH (Arterial)', unit: '', referenceRange: '7.35-7.45', normal: [7.35, 7.45] },
  { testName: 'PaCO2', unit: 'mmHg', referenceRange: '35-45', normal: [35, 45] },
  { testName: 'PaO2', unit: 'mmHg', referenceRange: '75-100', normal: [75, 100] },
  { testName: 'HCO3 (Arterial)', unit: 'mmol/L', referenceRange: '22-26', normal: [22, 26] },
  { testName: 'pH (Venous)', unit: '', referenceRange: '7.31-7.41', normal: [7.31, 7.41] },
  { testName: 'pCO2 (Venous)', unit: 'mmHg', referenceRange: '41-51', normal: [41, 51] },
  { testName: 'HCO3 (Venous)', unit: 'mmol/L', referenceRange: '22-26', normal: [22, 26] },
  { testName: 'Base Excess', unit: 'mmol/L', referenceRange: '-2 to +2', normal: [-2, 2] },
  { testName: 'Lactate', unit: 'mmol/L', referenceRange: '0.5-2.0', normal: [0.5, 2] },
  { testName: 'Troponin I (High-Sensitivity)', unit: 'ng/L', referenceRange: '0-14', normal: [0, 14] },
  { testName: 'BNP/NT-proBNP', unit: 'pg/mL', referenceRange: '0-100', normal: [0, 100] },
  { testName: 'CK Total', unit: 'U/L', referenceRange: '30-200', normal: [30, 200] },
  { testName: 'CK-MB', unit: 'ng/mL', referenceRange: '0.0-5.0', normal: [0, 5] },

  // Inflammatory/infectious markers
  { testName: 'CRP', unit: 'mg/dL', referenceRange: '0.0-0.5', normal: [0, 0.5] },
  { testName: 'ESR', unit: 'mm/hr', referenceRange: '0-20', normal: [0, 20] },
  { testName: 'Procalcitonin', unit: 'ng/mL', referenceRange: '0.00-0.10', normal: [0, 0.1] },
  { testName: 'Haptoglobin', unit: 'mg/dL', referenceRange: '30-200', normal: [30, 200] },
  { testName: 'LDH', unit: 'U/L', referenceRange: '140-280', normal: [140, 280] },
  { testName: 'Reticulocyte Count', unit: '%', referenceRange: '0.5-2.5', normal: [0.5, 2.5] },
  { testName: 'Lipase', unit: 'U/L', referenceRange: '13-60', normal: [13, 60] },
  { testName: 'Amylase', unit: 'U/L', referenceRange: '30-110', normal: [30, 110] },
  { testName: 'Beta-Hydroxybutyrate', unit: 'mmol/L', referenceRange: '0.00-0.40', normal: [0, 0.4] },

  // Endocrine/metabolic
  { testName: 'TSH', unit: 'uIU/mL', referenceRange: '0.4-4.5', normal: [0.4, 4.5] },
  { testName: 'Free T4', unit: 'ng/dL', referenceRange: '0.8-1.8', normal: [0.8, 1.8] },
  { testName: 'Total T3', unit: 'ng/dL', referenceRange: '80-200', normal: [80, 200] },
  { testName: 'Vitamin B12', unit: 'pg/mL', referenceRange: '200-900', normal: [200, 900] },
  { testName: 'Folate', unit: 'ng/mL', referenceRange: '3-17', normal: [3, 17] },
  { testName: 'Vitamin D 25-OH', unit: 'ng/mL', referenceRange: '20-50', normal: [20, 50] },
  { testName: 'Iron', unit: 'mcg/dL', referenceRange: '60-170', normal: [60, 170] },
  { testName: 'TIBC', unit: 'mcg/dL', referenceRange: '240-450', normal: [240, 450] },
  { testName: 'Ferritin', unit: 'ng/mL', referenceRange: '20-300', normal: [20, 300] },

  // Lipids/glucose
  { testName: 'Total Cholesterol', unit: 'mg/dL', referenceRange: '125-200', normal: [125, 200] },
  { testName: 'HDL', unit: 'mg/dL', referenceRange: '40-60', normal: [40, 60] },
  { testName: 'LDL', unit: 'mg/dL', referenceRange: '0-130', normal: [0, 130] },
  { testName: 'Triglycerides', unit: 'mg/dL', referenceRange: '0-150', normal: [0, 150] },
  { testName: 'Hemoglobin A1c', unit: '%', referenceRange: '4.0-5.6', normal: [4, 5.6] },
  { testName: 'Serum Osmolality', unit: 'mOsm/kg', referenceRange: '275-295', normal: [275, 295] },
  { testName: 'Serum Alcohol Level', unit: 'mg/dL', referenceRange: '0-10', normal: [0, 10] },
  { testName: 'Acetaminophen Level', unit: 'mcg/mL', referenceRange: '10-30', normal: [10, 30] },
  { testName: 'Salicylate Level', unit: 'mg/dL', referenceRange: '10-20', normal: [10, 20] },
  { testName: 'Digoxin Level', unit: 'ng/mL', referenceRange: '0.5-2.0', normal: [0.5, 2] },
  { testName: 'Lithium Level', unit: 'mEq/L', referenceRange: '0.6-1.2', normal: [0.6, 1.2] },
  { testName: 'Vancomycin Trough', unit: 'mcg/mL', referenceRange: '10-20', normal: [10, 20] },
  { testName: 'Vancomycin Peak', unit: 'mcg/mL', referenceRange: '25-40', normal: [25, 40] },
  { testName: 'Aminoglycoside Level', unit: 'mcg/mL', referenceRange: '5-10', normal: [5, 10] },
];

const randomInRange = (min: number, max: number) => Number((Math.random() * (max - min) + min).toFixed(1));

const resolveLabTemplates = (orderName?: string): LabTemplate[] => {
  const normalized = (orderName ?? '').toLowerCase().replace(/[–—]/g, '-');
  const templateMap = Object.fromEntries(labTemplates.map((t) => [t.testName.toLowerCase(), t]));

  const panelMatches: Record<string, string[]> = {
    'cbc with differential': [
      'white blood cell count',
      'neutrophils %',
      'lymphocytes %',
      'hemoglobin',
      'hematocrit',
      'platelets',
    ],
    cbc: ['white blood cell count', 'hemoglobin', 'hematocrit', 'platelets'],
    'complete blood count': ['white blood cell count', 'hemoglobin', 'hematocrit', 'platelets'],
    'basic metabolic panel': ['sodium', 'potassium', 'chloride', 'co2 (bicarbonate)', 'bun', 'creatinine', 'glucose', 'calcium'],
    bmp: ['sodium', 'potassium', 'chloride', 'co2 (bicarbonate)', 'bun', 'creatinine', 'glucose', 'calcium'],
    'comprehensive metabolic panel': [
      'sodium',
      'potassium',
      'chloride',
      'co2 (bicarbonate)',
      'bun',
      'creatinine',
      'glucose',
      'calcium',
      'ast',
      'alt',
      'alkaline phosphatase',
      'total bilirubin',
      'albumin',
    ],
    cmp: [
      'sodium',
      'potassium',
      'chloride',
      'co2 (bicarbonate)',
      'bun',
      'creatinine',
      'glucose',
      'calcium',
      'ast',
      'alt',
      'alkaline phosphatase',
      'total bilirubin',
      'albumin',
    ],
    'liver function panel': ['ast', 'alt', 'alkaline phosphatase', 'total bilirubin', 'albumin'],
    magnesium: ['magnesium'],
    phosphorus: ['phosphorus'],
    'calcium, total': ['calcium'],
    'calcium, ionized': ['ionized calcium'],
    'coagulation: pt/inr': ['pt', 'inr'],
    'coagulation: aptt': ['aptt'],
    fibrinogen: ['fibrinogen'],
    'd-dimer': ['d-dimer'],
    abg: ['ph (arterial)', 'paco2', 'pao2', 'hco3 (arterial)', 'lactate'],
    vbg: ['ph (venous)', 'pco2 (venous)', 'hco3 (venous)', 'base excess'],
    lactate: ['lactate'],
    troponin: ['troponin i (high-sensitivity)'],
    'troponin high-sensitivity': ['troponin i (high-sensitivity)'],
    bnp: ['bnp/nt-probnp'],
    'nt-probnp': ['bnp/nt-probnp'],
    'ck total': ['ck total'],
    'ck-mb': ['ck-mb'],
    crp: ['crp'],
    esr: ['esr'],
    procalcitonin: ['procalcitonin'],
    'thyroid: tsh': ['tsh'],
    'thyroid: free t4': ['free t4'],
    'thyroid: total t3': ['total t3'],
    'vitamin b12': ['vitamin b12'],
    folate: ['folate'],
    'vitamin d 25-oh': ['vitamin d 25-oh'],
    'iron, tibc, ferritin panel': ['iron', 'tibc', 'ferritin'],
    'lipid panel': ['total cholesterol', 'hdl', 'ldl', 'triglycerides'],
    'hemoglobin a1c': ['hemoglobin a1c'],
    'glucose poc': ['glucose'],
    'serum osmolality': ['serum osmolality'],
    'haptoglobin': ['haptoglobin'],
    'ldh': ['ldh'],
    'reticulocyte count': ['reticulocyte count'],
    lipase: ['lipase'],
    amylase: ['amylase'],
    'beta-hydroxybutyrate': ['beta-hydroxybutyrate'],
    'ketone beta-hydroxybutyrate': ['beta-hydroxybutyrate'],
    'serum alcohol level': ['serum alcohol level'],
    'acetaminophen level': ['acetaminophen level'],
    'salicylate level': ['salicylate level'],
    'digoxin level': ['digoxin level'],
    'lithium level': ['lithium level'],
    'vancomycin trough': ['vancomycin trough'],
    'vancomycin peak': ['vancomycin peak'],
    'aminoglycoside level': ['aminoglycoside level'],
    'bnp/nt-probnp': ['bnp/nt-probnp'],
  };

  const matchedPanelKey = Object.keys(panelMatches).find((key) => normalized.includes(key));
  if (matchedPanelKey) {
    const panel = panelMatches[matchedPanelKey];
    return panel
      .map((name) => templateMap[name])
      .filter(Boolean) as LabTemplate[];
  }

  const directMatches = labTemplates.filter((template) => normalized.includes(template.testName.toLowerCase()));
  if (directMatches.length) return directMatches;

  const defaultPanel = ['white blood cell count', 'hemoglobin', 'platelets', 'sodium', 'potassium', 'creatinine', 'glucose'];
  return defaultPanel.map((name) => templateMap[name]).filter(Boolean) as LabTemplate[];
};

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
  const templates = resolveLabTemplates(context?.orderName ?? caseDescription);

  const results = templates.map((template, index) => {
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
