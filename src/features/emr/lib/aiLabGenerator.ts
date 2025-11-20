import type { LabResult, VitalSigns } from './types';

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

export async function generateLabResults(patientId: string, caseDescription: string): Promise<LabResult[]> {
  const emphasis = caseDescription.toLowerCase().includes('infection') ? 'Abnormal' : 'Normal';

  const results = labTemplates.map((template, index) => {
    const variance = emphasis === 'Abnormal' ? 0.25 : 0.1;
    const low = template.normal[0];
    const high = template.normal[1];
    const multiplier = emphasis === 'Abnormal' && index % 2 === 0 ? 1 + variance : 1;
    const value =
      index % 2 === 0
        ? randomInRange(low * (1 - variance), high * multiplier)
        : randomInRange(low, high);
    const status = emphasizeStatus(deriveLabStatus(value, template.normal), emphasis);

    return {
      id: `generated-lab-${Date.now()}-${index}`,
      patientId,
      testName: template.testName,
      value,
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
