export type AssignmentStatus = string | null | undefined;

export const assignmentStatusLabel = (status: AssignmentStatus): string => {
  switch (status) {
    case 'assigned':
      return 'Assigned';
    case 'in_progress':
      return 'In Progress';
    case 'bedside':
      return 'Bedside';
    case 'completed':
      return 'Completed';
    case null:
    case undefined:
    case '':
      return 'Unknown';
    default:
      return status
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
};

export const assignmentStatusTone = (status: AssignmentStatus): string => {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700';
    case 'bedside':
      return 'bg-blue-100 text-blue-700';
    case 'in_progress':
      return 'bg-amber-100 text-amber-700';
    case 'assigned':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
};
