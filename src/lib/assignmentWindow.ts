export type AssignmentWindow = {
  is_sandbox?: boolean | null;
  window_start?: string | null;
};

/** Practice/sandbox assignments may be opened immediately; scheduled learner
 * assignments cannot be activated before their persisted start time. */
export const isAssignmentWindowOpen = (
  assignment: AssignmentWindow,
  now = new Date(),
): boolean => {
  if (assignment.is_sandbox) return true;
  if (!assignment.window_start) return true;
  const start = new Date(assignment.window_start);
  return Number.isNaN(start.getTime()) || start.getTime() <= now.getTime();
};
