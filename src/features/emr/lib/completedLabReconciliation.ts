import { isResultProducingStatLab } from './labOrderEligibility';
import type { LabResult, MedicalOrder, Patient } from './types';

type LabTemplate = { testName: string; unit: string; referenceRange: string };

export const buildMissingCompletedLabResults = ({
  order,
  patient,
  assignmentId,
  existingLabs,
  generatedLabs,
  templates,
}: {
  order: MedicalOrder;
  patient: Patient;
  assignmentId: string;
  existingLabs: LabResult[];
  generatedLabs: LabResult[];
  templates: LabTemplate[];
}): LabResult[] => {
  if (!isResultProducingStatLab(order) || order.status !== 'Completed') return [];
  const existingNames = new Set(
    existingLabs
      .filter((lab) => lab.assignmentId === assignmentId && lab.roomId === patient.roomId)
      .map((lab) => lab.testName.toLowerCase()),
  );
  const generatedByName = new Map(generatedLabs.map((lab) => [lab.testName.toLowerCase(), lab]));
  return templates
    .filter((template) => !existingNames.has(template.testName.toLowerCase()))
    .map((template, index) => {
      const generated = generatedByName.get(template.testName.toLowerCase());
      return {
        id: generated?.id ?? `completed-lab-${order.id}-${index}`,
        patientId: patient.id,
        assignmentId,
        roomId: patient.roomId,
        overrideScope: 'assignment' as const,
        testName: template.testName,
        value: generated?.value ?? 0,
        unit: generated?.unit ?? template.unit,
        referenceRange: generated?.referenceRange ?? template.referenceRange,
        status: generated?.status ?? 'Normal',
        collectionTime: order.orderTime,
        resultTime: order.orderTime,
        orderedBy: order.orderedBy,
      };
    });
};
