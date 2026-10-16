type ScheduledAssignment = {
  is_sandbox?: boolean | null;
  window_start?: string | null;
};

export const isAssignmentWindowOpen = (assignment: ScheduledAssignment, now = new Date()): boolean => {
  if (assignment.is_sandbox) return true;
  if (!assignment.window_start) return true;
  const start = new Date(assignment.window_start).getTime();
  return Number.isNaN(start) || start <= now.getTime();
};
