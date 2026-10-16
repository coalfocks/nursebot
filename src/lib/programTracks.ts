export type LearnerProgram = 'medical' | 'nursing';

export const LEARNER_PROGRAMS: Array<{ value: LearnerProgram; label: string }> = [
  { value: 'medical', label: 'Medical Student' },
  { value: 'nursing', label: 'Nursing Student' },
];

export const getLearnerProgramLabel = (program: string | null | undefined) =>
  LEARNER_PROGRAMS.find((option) => option.value === program)?.label ?? 'Unspecified program';

export const normalizeLearnerProgram = (program: string | null | undefined): LearnerProgram =>
  program === 'nursing' ? 'nursing' : 'medical';

export const getSchoolDisplayLabel = (name: string, displayName?: string | null) =>
  displayName?.trim() || name;
