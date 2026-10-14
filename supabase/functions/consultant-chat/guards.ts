export const canCreateConsultantWrite = (assignmentStatus: string | null | undefined): boolean =>
  assignmentStatus !== 'completed';

export const shouldCleanupConsultantArtifacts = (requestCreatedHere: boolean): boolean => requestCreatedHere;
