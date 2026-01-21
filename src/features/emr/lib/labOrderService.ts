import { supabase } from '../../../lib/supabase';
import { labTypeByName } from './labCatalog';
import type { LabResult, LabOrderSetting, RoomOrdersConfig } from './types';

type LabPriority = 'Routine' | 'STAT' | 'Timed';

interface GenerateLabResultParams {
  patientId: string;
  labName: string;
  priority: LabPriority;
  orderedBy?: string;
  ordersConfig?: RoomOrdersConfig | null;
  labSetting?: LabOrderSetting | null;
  assignmentId?: string | null;
}

const extractNumericValue = (valueOverride?: string | null) => {
  if (!valueOverride) return null;
  const match = valueOverride.match(/-?\\d+(?:\\.\\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
};

const buildFallbackLabResult = ({
  patientId,
  labName,
  orderedBy,
  valueOverride,
  assignmentId,
}: {
  patientId: string;
  labName: string;
  orderedBy?: string;
  valueOverride?: string | null;
  assignmentId?: string | null;
}): LabResult => {
  const now = new Date().toISOString();
  const numericValue = extractNumericValue(valueOverride) ?? Number((Math.random() * 3 + 10).toFixed(1));
  const status =
    typeof valueOverride === 'string' && /critical|high|low|abnormal|elevated|decreased|up|down/i.test(valueOverride)
      ? 'Abnormal'
      : 'Normal';

  return {
    id: `lab-${Date.now()}`,
    patientId,
    assignmentId: assignmentId ?? null,
    testName: labName,
    value: numericValue,
    unit: '',
    referenceRange: 'See interpretation',
    status,
    collectionTime: now,
    resultTime: now,
    orderedBy: orderedBy ?? 'EMR Auto',
  };
};

const requestAiLabResult = async ({
  patientId,
  labName,
  priority,
  ordersConfig,
  valueOverride,
  assignmentId,
}: {
  patientId: string;
  labName: string;
  priority: LabPriority;
  ordersConfig?: RoomOrdersConfig | null;
  valueOverride?: string | null;
  assignmentId?: string | null;
}) => {
  const { data, error } = await supabase.functions.invoke('lab-results', {
    body: {
      patientId,
      labName,
      priority,
      ordersConfig,
      valueOverride,
      labType: labTypeByName.get(labName) ?? 'instant',
      assignmentId,
    },
  });

  if (error) {
    throw error;
  }

  return data as {
    value?: number | string | null;
    unit?: string | null;
    referenceRange?: string | null;
    status?: LabResult['status'];
  } | null;
};

export const generateLabResultForOrder = async ({
  patientId,
  labName,
  priority,
  orderedBy,
  ordersConfig,
  labSetting,
  assignmentId,
}: GenerateLabResultParams): Promise<LabResult> => {
  const valueOverride = labSetting?.valueOverride ?? null;
  try {
    const aiLab = await requestAiLabResult({
      patientId,
      labName,
      priority,
      ordersConfig,
      valueOverride,
      assignmentId: assignmentId ?? null,
    });
    if (aiLab) {
      const now = new Date().toISOString();
      const derivedValue = typeof aiLab.value === 'number' ? aiLab.value : extractNumericValue(String(aiLab.value ?? ''));
      return {
        id: `lab-${Date.now()}`,
        patientId,
        assignmentId: assignmentId ?? null,
        testName: labName,
        value: derivedValue ?? 0,
        unit: aiLab.unit ?? '',
        referenceRange: aiLab.referenceRange ?? 'See interpretation',
        status: aiLab.status ?? 'Normal',
        collectionTime: now,
        resultTime: now,
        orderedBy: orderedBy ?? 'EMR Auto',
      };
    }
  } catch (error) {
    console.error('AI lab generation failed, falling back to nominal values', error);
  }

  return buildFallbackLabResult({ patientId, labName, orderedBy, priority, valueOverride, assignmentId });
};
