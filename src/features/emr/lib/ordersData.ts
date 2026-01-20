import { instantLabs, pendingLabs } from './labCatalog';
import { medicationOrdersFromCsv } from './generatedMedicationOrders';

// Comprehensive orders data based on the provided CSV files
export interface OrderItem {
  id: string;
  name: string;
  category: 'Lab' | 'Medication' | 'Imaging' | 'Procedure' | 'Diet' | 'Activity' | 'Nursing' | 'Consult' | 'General';
  subcategory?: string;
  frequencies?: string[];
  routes?: string[];
  priorities: ('Routine' | 'STAT' | 'Timed')[];
  defaultDose?: string;
  units?: string[];
  instructions?: string;
}

const expandFrequencyRange = (frequency: string): string[] => {
  const trimmed = frequency.trim();
  const match = trimmed.match(/^q\s*(\d+)\s*-\s*(\d+)\s*h(\s*PRN)?$/i);
  if (!match) return [trimmed];
  const suffix = match[3] ? ' PRN' : '';
  const start = match[1];
  const end = match[2];
  return [`q${start}h${suffix}`, `q${end}h${suffix}`];
};

const normalizeFrequencies = (frequencies?: string[]): string[] | undefined => {
  if (!frequencies?.length) return frequencies;
  const normalized = frequencies
    .flatMap(expandFrequencyRange)
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

const curatedLabOrders: OrderItem[] = [
  {
    id: 'lab-1',
    name: 'Complete Blood Count with Differential',
    category: 'Lab',
    subcategory: 'Hematology',
    frequencies: ['Once', 'Daily', 'BID', 'q8h', 'q12h'],
    priorities: ['Routine', 'STAT', 'Timed'],
  },
  {
    id: 'lab-2',
    name: 'Basic Metabolic Panel',
    category: 'Lab',
    subcategory: 'Chemistry',
    frequencies: ['Once', 'Daily', 'BID', 'q8h'],
    priorities: ['Routine', 'STAT', 'Timed'],
  },
  {
    id: 'lab-3',
    name: 'Comprehensive Metabolic Panel',
    category: 'Lab',
    subcategory: 'Chemistry',
    frequencies: ['Once', 'Daily', 'BID'],
    priorities: ['Routine', 'STAT', 'Timed'],
  },
  {
    id: 'lab-4',
    name: 'Liver Function Panel',
    category: 'Lab',
    subcategory: 'Chemistry',
    frequencies: ['Once', 'Daily', 'Weekly'],
    priorities: ['Routine', 'STAT', 'Timed'],
  },
  {
    id: 'lab-5',
    name: 'Lipid Panel',
    category: 'Lab',
    subcategory: 'Chemistry',
    frequencies: ['Once', 'Daily'],
    priorities: ['Routine', 'Timed'],
  },
  {
    id: 'lab-6',
    name: 'Hemoglobin A1c',
    category: 'Lab',
    subcategory: 'Chemistry',
    frequencies: ['Once'],
    priorities: ['Routine'],
  },
  {
    id: 'lab-7',
    name: 'Troponin High-Sensitivity — Now',
    category: 'Lab',
    subcategory: 'Cardiac',
    frequencies: ['Once', 'q6h', 'q8h'],
    priorities: ['STAT', 'Routine', 'Timed'],
  },
  {
    id: 'lab-8',
    name: 'BNP/NT-proBNP',
    category: 'Lab',
    subcategory: 'Cardiac',
    frequencies: ['Once', 'Daily'],
    priorities: ['STAT', 'Routine'],
  },
  {
    id: 'lab-9',
    name: 'D-dimer',
    category: 'Lab',
    subcategory: 'Coagulation',
    frequencies: ['Once', 'Daily'],
    priorities: ['STAT', 'Routine'],
  },
  {
    id: 'lab-10',
    name: 'Coagulation: PT/INR',
    category: 'Lab',
    subcategory: 'Coagulation',
    frequencies: ['Once', 'Daily', 'BID'],
    priorities: ['STAT', 'Routine', 'Timed'],
  },
];

const instantLabOrders: OrderItem[] = instantLabs.map((name, index) => ({
  id: `lab-instant-${index}`,
  name,
  category: 'Lab',
  subcategory: 'Instant Lab',
  frequencies: ['Once'],
  priorities: ['Routine', 'STAT', 'Timed'],
}));

const pendingLabOrders: OrderItem[] = pendingLabs.map((name, index) => ({
  id: `lab-pending-${index}`,
  name,
  category: 'Lab',
  subcategory: 'Pending Lab',
  frequencies: ['Once'],
  priorities: ['Routine'],
}));

const labOrdersMap = new Map<string, OrderItem>();
[...curatedLabOrders, ...instantLabOrders, ...pendingLabOrders].forEach((order) => {
  const key = order.name.toLowerCase();
  if (!labOrdersMap.has(key)) {
    labOrdersMap.set(key, order);
  }
});

export const labOrders: OrderItem[] = Array.from(labOrdersMap.values());

const baseMedicationOrders: OrderItem[] = [
  {
    id: 'med-1',
    name: 'Lisinopril',
    category: 'Medication',
    subcategory: 'ACE Inhibitor',
    frequencies: ['Daily', 'BID'],
    routes: ['PO'],
    priorities: ['Routine'],
    defaultDose: '10',
    units: ['mg'],
  },
  {
    id: 'med-2',
    name: 'Metformin',
    category: 'Medication',
    subcategory: 'Antidiabetic',
    frequencies: ['Daily', 'BID'],
    routes: ['PO'],
    priorities: ['Routine'],
    defaultDose: '500',
    units: ['mg'],
  },
  {
    id: 'med-3',
    name: 'Morphine',
    category: 'Medication',
    subcategory: 'Opioid Analgesic',
    frequencies: ['q4h PRN', 'q6h PRN', 'q2h PRN'],
    routes: ['PO', 'IV', 'IM'],
    priorities: ['Routine', 'STAT'],
    defaultDose: '2',
    units: ['mg'],
  },
  {
    id: 'med-4',
    name: 'Acetaminophen',
    category: 'Medication',
    subcategory: 'Analgesic',
    frequencies: ['q6h', 'q8h', 'PRN'],
    routes: ['PO', 'IV'],
    priorities: ['Routine'],
    defaultDose: '650',
    units: ['mg'],
  },
  {
    id: 'med-5',
    name: 'Furosemide',
    category: 'Medication',
    subcategory: 'Diuretic',
    frequencies: ['Daily', 'BID', 'PRN'],
    routes: ['PO', 'IV'],
    priorities: ['Routine', 'STAT'],
    defaultDose: '20',
    units: ['mg'],
  },
  {
    id: 'med-6',
    name: 'Lactated Ringers Bolus',
    category: 'Medication',
    subcategory: 'IV Fluids',
    frequencies: ['Once', 'PRN'],
    routes: ['IV'],
    priorities: ['Routine', 'STAT'],
    defaultDose: '500',
    units: ['mL'],
  },
  {
    id: 'med-7',
    name: 'Lactated Ringers Maintenance',
    category: 'Medication',
    subcategory: 'IV Fluids',
    frequencies: ['per hour'],
    routes: ['IV'],
    priorities: ['Routine'],
    defaultDose: '100',
    units: ['mL'],
  },
  {
    id: 'med-8',
    name: 'Normal Saline Bolus',
    category: 'Medication',
    subcategory: 'IV Fluids',
    frequencies: ['Once', 'PRN'],
    routes: ['IV'],
    priorities: ['Routine', 'STAT'],
    defaultDose: '500',
    units: ['mL'],
  },
  {
    id: 'med-9',
    name: 'Normal Saline Maintenance',
    category: 'Medication',
    subcategory: 'IV Fluids',
    frequencies: ['per hour'],
    routes: ['IV'],
    priorities: ['Routine'],
    defaultDose: '100',
    units: ['mL'],
  },
  {
    id: 'med-10',
    name: 'Sodium Bicarbonate Bolus',
    category: 'Medication',
    subcategory: 'IV Fluids',
    frequencies: ['Once', 'PRN'],
    routes: ['IV'],
    priorities: ['Routine', 'STAT'],
    defaultDose: '50',
    units: ['mEq'],
  },
  {
    id: 'med-11',
    name: 'Sodium Bicarbonate Maintenance',
    category: 'Medication',
    subcategory: 'IV Fluids',
    frequencies: ['per hour'],
    routes: ['IV'],
    priorities: ['Routine'],
    defaultDose: '50',
    units: ['mEq'],
  },
];

const medicationOrdersMap = new Map<string, OrderItem>();
[...baseMedicationOrders, ...medicationOrdersFromCsv].forEach((order) => {
  const key = order.name.toLowerCase();
  if (!medicationOrdersMap.has(key)) {
    medicationOrdersMap.set(key, {
      ...order,
      frequencies: normalizeFrequencies(order.frequencies),
    });
  }
});

export const medicationOrders: OrderItem[] = Array.from(medicationOrdersMap.values());

export const imagingOrders: OrderItem[] = [
  {
    id: 'img-1',
    name: 'X-ray',
    category: 'Imaging',
    subcategory: 'X-Ray',
    frequencies: ['Once'],
    priorities: ['Routine', 'STAT'],
  },
  {
    id: 'img-2',
    name: 'CT (Without Contrast)',
    category: 'Imaging',
    subcategory: 'CT',
    frequencies: ['Once'],
    priorities: ['STAT', 'Routine'],
  },
  {
    id: 'img-3',
    name: 'CT (With Contrast)',
    category: 'Imaging',
    subcategory: 'CT',
    frequencies: ['Once'],
    priorities: ['STAT', 'Routine'],
  },
  {
    id: 'img-4',
    name: 'MRI (Without Contrast)',
    category: 'Imaging',
    subcategory: 'MRI',
    frequencies: ['Once'],
    priorities: ['Routine', 'STAT'],
  },
  {
    id: 'img-5',
    name: 'MRI (With Contrast)',
    category: 'Imaging',
    subcategory: 'MRI',
    frequencies: ['Once'],
    priorities: ['Routine', 'STAT'],
  },
  {
    id: 'img-6',
    name: 'Ultrasound',
    category: 'Imaging',
    subcategory: 'Ultrasound',
    frequencies: ['Once'],
    priorities: ['Routine', 'STAT'],
  },
  {
    id: 'img-7',
    name: 'Echocardiogram',
    category: 'Imaging',
    subcategory: 'Echocardiogram',
    frequencies: ['Once'],
    priorities: ['Routine', 'STAT'],
  },
  {
    id: 'img-8',
    name: 'EKG',
    category: 'Imaging',
    subcategory: 'Cardiac',
    frequencies: ['Once'],
    priorities: ['Routine', 'STAT'],
  },
];

const consultOrders: OrderItem[] = [
  {
    id: 'consult-1',
    name: 'Consult',
    category: 'Consult',
    priorities: ['Routine', 'STAT'],
  },
];

const nursingOrders: OrderItem[] = [
  {
    id: 'nursing-1',
    name: 'Nursing',
    category: 'Nursing',
    priorities: ['Routine', 'STAT'],
  },
  {
    id: 'nursing-2',
    name: 'Bladder Scan',
    category: 'Nursing',
    priorities: ['Routine'],
  },
  {
    id: 'nursing-3',
    name: 'Straight Cath',
    category: 'Nursing',
    priorities: ['Routine'],
  },
];

const generalOrders: OrderItem[] = [
  {
    id: 'general-1',
    name: 'General',
    category: 'General',
    priorities: ['Routine', 'STAT'],
  },
];

export const allOrders: OrderItem[] = [
  ...labOrders,
  ...medicationOrders,
  ...imagingOrders,
  ...consultOrders,
  ...nursingOrders,
  ...generalOrders,
];

export const frequencies = [
  { code: 'Once', description: 'One time only', category: 'Single' },
  { code: 'Daily', description: 'Once daily', category: 'Daily' },
  { code: 'BID', description: 'Twice daily', category: 'Daily' },
  { code: 'TID', description: 'Three times daily', category: 'Daily' },
  { code: 'QID', description: 'Four times daily', category: 'Daily' },
  { code: 'q4h', description: 'Every 4 hours', category: 'Hourly' },
  { code: 'q6h', description: 'Every 6 hours', category: 'Hourly' },
  { code: 'q8h', description: 'Every 8 hours', category: 'Hourly' },
  { code: 'q12h', description: 'Every 12 hours', category: 'Hourly' },
  { code: 'PRN', description: 'As needed', category: 'PRN' },
  { code: 'Weekly', description: 'Once weekly', category: 'Weekly' },
];

export const routes = [
  { code: 'PO', description: 'By mouth (oral)', category: 'Oral' },
  { code: 'IV', description: 'Intravenous', category: 'Parenteral' },
  { code: 'IM', description: 'Intramuscular', category: 'Parenteral' },
  { code: 'SQ', description: 'Subcutaneous', category: 'Parenteral' },
  { code: 'SL', description: 'Sublingual', category: 'Oral' },
  { code: 'PR', description: 'Per rectum', category: 'Other' },
  { code: 'TOP', description: 'Topical', category: 'Other' },
];
