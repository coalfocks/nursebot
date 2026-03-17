import { Loader2, Target, ClipboardList } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room?: Database['public']['Tables']['rooms']['Row'] | null;
};

interface AssignmentFeedbackProps {
  assignment: Assignment;
  onRetryFeedback?: () => void;
}

type LegacyFeedback = {
  summary?: string | null;
};

export default function AssignmentFeedback({ assignment, onRetryFeedback }: AssignmentFeedbackProps) {
  // Only show feedback when status is completed
  if (!['completed', 'bedside'].includes(assignment.status)) {
    return null;
  }

  if (assignment.feedback_status === 'pending' || assignment.feedback_status === 'processing') {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-center space-x-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <p className="text-gray-600">
            {assignment.feedback_status === 'pending'
              ? 'Waiting to generate feedback...'
              : 'Generating feedback...'}
          </p>
        </div>
      </div>
    );
  }

  if (assignment.feedback_status === 'failed') {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to generate feedback</p>
          {assignment.feedback_error && (
            <p className="text-sm text-gray-600 mb-4">{assignment.feedback_error}</p>
          )}
          {onRetryFeedback && (
            <button
              onClick={onRetryFeedback}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Retry Feedback Generation
            </button>
          )}
        </div>
      </div>
    );
  }

  const caseGoals = assignment.room?.case_goals?.trim() || 'No case goals were configured for this room.';
  const feedback = (assignment.nurse_feedback as LegacyFeedback | null) ?? null;
  const learningObjectives = ((assignment as Assignment & { learning_objectives?: string | null }).learning_objectives ?? '').trim();
  const summary = learningObjectives || feedback?.summary?.trim() || 'No summary available yet.';

  return (
    <div className="bg-white shadow rounded-lg p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Evaluation Summary</h2>
        <p className="mt-1 text-sm text-gray-500">Focused on room goals and student performance against those goals.</p>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
        <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
          <Target className="h-4 w-4" />
          Case Goals
        </h3>
        <p className="mt-2 text-sm whitespace-pre-wrap text-blue-900">{caseGoals}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <ClipboardList className="h-4 w-4" />
          Student Performance Summary
        </h3>
        <p className="mt-2 text-sm whitespace-pre-wrap text-slate-700">{summary}</p>
      </div>

      {assignment.feedback_generated_at && (
        <div className="text-xs text-gray-500 text-right">
          Generated on {new Date(assignment.feedback_generated_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}
