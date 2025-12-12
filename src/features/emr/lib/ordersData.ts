import { instantLabs, pendingLabs } from './labCatalog';

// Comprehensive orders data based on the provided CSV files
export interface OrderItem {
  id: string;
  name: string;
  category: 'Lab' | 'Medication' | 'Imaging' | 'Procedure' | 'Diet' | 'Activity' | 'Nursing';
  subcategory?: string;
  frequencies?: string[];
  routes?: string[];
  priorities: ('Routine' | 'STAT' | 'Timed')[];
  defaultDose?: string;
  units?: string[];
  instructions?: string;
}

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

export const medicationOrders: OrderItem[] = [
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
];

export const imagingOrders: OrderItem[] = [
  {
    id: 'img-1',
    name: 'Chest X-Ray PA & Lateral',
    category: 'Imaging',
    subcategory: 'X-Ray',
    frequencies: ['Once', 'Daily', 'PRN'],
    priorities: ['Routine', 'STAT'],
  },
  {
    id: 'img-2',
    name: 'CT Head Without Contrast',
    category: 'Imaging',
    subcategory: 'CT',
    frequencies: ['Once'],
    priorities: ['STAT', 'Routine'],
  },
  {
    id: 'img-3',
    name: 'CT Chest/Abdomen/Pelvis With Contrast',
    category: 'Imaging',
    subcategory: 'CT',
    frequencies: ['Once'],
    priorities: ['STAT', 'Routine'],
  },
  {
    id: 'img-4',
    name: 'MRI Brain With & Without Contrast',
    category: 'Imaging',
    subcategory: 'MRI',
    frequencies: ['Once'],
    priorities: ['Routine'],
  },
  {
    id: 'img-5',
    name: 'Ultrasound Abdomen Complete',
    category: 'Imaging',
    subcategory: 'Ultrasound',
    frequencies: ['Once', 'PRN'],
    priorities: ['Routine', 'STAT'],
  },
];

export const allOrders: OrderItem[] = [...labOrders, ...medicationOrders, ...imagingOrders];

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
