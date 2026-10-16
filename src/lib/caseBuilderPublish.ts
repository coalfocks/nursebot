export const REQUIRED_GENERATED_SECTIONS = [
  'patient',
  'emr',
  'event',
  'orders',
  'bedside',
  'nurse_chat',
  'evaluation',
] as const;

export type GeneratedSectionName = (typeof REQUIRED_GENERATED_SECTIONS)[number];
export type GeneratedCasePackage = Partial<Record<GeneratedSectionName, Record<string, unknown>>>;

export type CasePublishValidationIssue = {
  code: 'CASE_PACKAGE_SECTION_REQUIRED' | 'CASE_PACKAGE_FIELD_REQUIRED' | 'CASE_PATIENT_IDENTITY_REQUIRED' | 'CASE_BEDSIDE_PROMPT_REQUIRED';
  path: string;
  message: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fieldLabel = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
const hasContent = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasContent);
  return isRecord(value) && Object.values(value).some(hasContent);
};

export const validateGeneratedCasePackage = (
  value: unknown,
): { ok: true; value: GeneratedCasePackage } | { ok: false; issue: CasePublishValidationIssue } => {
  if (!isRecord(value)) {
    return {
      ok: false,
      issue: {
        code: 'CASE_PACKAGE_SECTION_REQUIRED',
        path: 'generation_package.patient',
        message: 'Generate the patient section before publishing.',
      },
    };
  }

  for (const section of REQUIRED_GENERATED_SECTIONS) {
    if (!isRecord(value[section])) {
      return {
        ok: false,
        issue: {
          code: 'CASE_PACKAGE_SECTION_REQUIRED',
          path: `generation_package.${section}`,
          message: `Generate the ${section.replace('_', ' ')} section before publishing.`,
        },
      };
    }
  }

  const patient = value.patient as Record<string, unknown>;
  const identity = getStructuredPatientIdentity(patient);
  if (!identity.firstName || !identity.lastName || !identity.dateOfBirth || !identity.gender) {
    return {
      ok: false,
      issue: {
        code: 'CASE_PATIENT_IDENTITY_REQUIRED',
        path: 'generation_package.patient.demographics',
        message: 'Generate structured fictional first name, last name, date of birth, and gender before publishing so the EMR patient can be linked.',
      },
    };
  }

  const requiredContent: Array<[GeneratedSectionName, string[]]> = [
    ['emr', ['hAndP', 'admissionExam']],
    ['event', ['trigger', 'nurseObservations']],
    ['orders', ['admissionOrders', 'gatedResults', 'imaging']],
    ['nurse_chat', ['initialMessage', 'behaviorRules', 'knownFacts', 'protectedFacts']],
    ['evaluation', ['goals', 'expectedWorkup', 'criticalActions', 'unsafeActions', 'bedsideVerdict']],
  ];
  for (const [sectionName, fields] of requiredContent) {
    const section = value[sectionName] as Record<string, unknown>;
    const complete = fields.some((field) => hasContent(section[field]));
    if (!complete) {
      const missing = fields[0];
      return {
        ok: false,
        issue: {
          code: 'CASE_PACKAGE_FIELD_REQUIRED',
          path: `generation_package.${sectionName}.${missing}`,
          message: `Add authored ${fieldLabel(missing)} content before publishing.`,
        },
      };
    }
  }

  const bedside = value.bedside as Record<string, unknown>;
  if (bedside.patientChatEnabled === true && optionalString(bedside.patientChatPrompt) == null) {
    return {
      ok: false,
      issue: {
        code: 'CASE_BEDSIDE_PROMPT_REQUIRED',
        path: 'generation_package.bedside.patientChatPrompt',
        message: 'Add a realistic patient conversation prompt or disable bedside patient chat before publishing.',
      },
    };
  }

  return { ok: true, value: value as GeneratedCasePackage };
};

const pickFields = <T extends readonly string[]>(
  value: Record<string, unknown>,
  fields: T,
): Partial<Record<T[number], unknown>> => {
  const picked: Partial<Record<T[number], unknown>> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) picked[field] = value[field];
  }
  return picked;
};

const learnerFieldAllowlist = {
  patient: ['demographics', 'allergies', 'codeStatus', 'medicationList', 'intakeOutput'] as const,
  emr: [
    'admissionVitals',
    'admissionLabs',
    'admissionExam',
    'hAndP',
    'dailyProgressNotes',
    'consultNotes',
    'nursingNotes',
    'labTrends',
    'hospitalTimeline',
  ] as const,
  event: ['trigger', 'eventVitals', 'nurseObservations', 'timeCourse'] as const,
  // expectedOrders and harmfulOrUnnecessary are evaluator-facing and intentionally excluded.
  orders: ['admissionOrders', 'gatedResults', 'imaging'] as const,
};

export const buildLearnerEmrContext = (
  generatedPackage: GeneratedCasePackage,
  blueprintId: string,
  generatedAt: string,
) => {
  void generatedAt;
  return {
    source: 'case-builder-v2',
    blueprintId,
    patient: pickFields(generatedPackage.patient ?? {}, learnerFieldAllowlist.patient),
    emr: pickFields(generatedPackage.emr ?? {}, learnerFieldAllowlist.emr),
    event: pickFields(generatedPackage.event ?? {}, learnerFieldAllowlist.event),
    orders: pickFields(generatedPackage.orders ?? {}, learnerFieldAllowlist.orders),
  };
};

const optionalString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const isIsoDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

export type StructuredPatientIdentity = {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
};

export const getStructuredPatientIdentity = (
  patient: Record<string, unknown>,
): StructuredPatientIdentity => {
  const demographics = isRecord(patient.demographics) ? patient.demographics : {};
  const dateOfBirth = optionalString(patient.dateOfBirth ?? patient.date_of_birth
    ?? demographics.dateOfBirth ?? demographics.date_of_birth);

  return {
    firstName: optionalString(patient.firstName ?? patient.first_name
      ?? demographics.firstName ?? demographics.first_name),
    lastName: optionalString(patient.lastName ?? patient.last_name
      ?? demographics.lastName ?? demographics.last_name),
    dateOfBirth: dateOfBirth && isIsoDate(dateOfBirth) ? dateOfBirth : null,
    gender: optionalString(patient.gender ?? demographics.gender),
  };
};

export const buildDeterministicMrn = (schoolId: string, blueprintId: string, roomNumber: string) =>
  `CB-${schoolId}-${blueprintId}-${encodeURIComponent(roomNumber.trim())}`;

export const buildDeterministicPatientId = async (
  schoolId: string,
  blueprintId: string,
  roomNumber: string,
) => {
  const source = new TextEncoder().encode(`${schoolId}:${blueprintId}:${roomNumber.trim()}`);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', source)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
