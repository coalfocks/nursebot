import { Award, MessageSquare, Brain, Target, Lightbulb, Loader2 } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room?: Database['public']['Tables']['rooms']['Row'];
};

interface FeedbackSidebarProps {
  assignment: Assignment;
}

export function FeedbackSidebar({ assignment }: FeedbackSidebarProps) {
  // Only show for completed/bedside status
  if (!['completed', 'bedside'].includes(assignment.status || '')) {
    return null;
  }

  // Show loading state
  if (assignment.feedback_status === 'pending' || assignment.feedback_status === 'processing') {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-center space-x-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">
            {assignment.feedback_status === 'pending'
              ? 'Generating feedback...'
              : 'Processing feedback...'}
          </p>
        </div>
      </div>
    );
  }

  // Show error state
  if (assignment.feedback_status === 'failed') {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="text-center">
          <p className="text-sm text-red-600">Something went wrong generating feedback</p>
        </div>
      </div>
    );
  }

  // No feedback yet
  if (assignment.communication_score == null && assignment.mdm_score == null) {
    return null;
  }

  const commScore = assignment.communication_score;
  const mdmScore = assignment.mdm_score;
  const availableScores = [commScore, mdmScore].filter((score): score is number => score != null);
  const computedGrade =
    availableScores.length > 0
      ? Math.round((availableScores.reduce((sum, score) => sum + score, 0) / availableScores.length) * 20)
      : null;
  const grade = assignment.grade ?? computedGrade;

  const getScoreColor = (score: number) => {
    if (score >= 4.5) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 3.5) return 'text-blue-600 bg-blue-50 border-blue-200';
    if (score >= 2.5) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getGradeColor = (g: number) => {
    if (g >= 90) return 'text-green-600';
    if (g >= 80) return 'text-blue-600';
    if (g >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="bg-white shadow rounded-lg p-6 space-y-5">
      <div className="flex items-center gap-2 border-b pb-3">
        <Award className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-semibold text-gray-900">Your Results</h2>
      </div>

      {/* Grade */}
      <div className="text-center py-2">
        {grade != null ? (
          <div className={`text-4xl font-bold ${getGradeColor(grade)}`}>{grade}</div>
        ) : (
          <div className="text-4xl font-bold text-gray-400">--</div>
        )}
        <p className="text-xs text-gray-500 mt-1">Overall Grade</p>
      </div>

      {/* Score Circles */}
      <div className="grid grid-cols-2 gap-3">
        {/* Communication Score */}
        <div className="text-center">
          {commScore != null ? (
            <div
              className={`w-14 h-14 mx-auto rounded-full border-2 flex items-center justify-center font-bold text-lg ${getScoreColor(commScore)}`}
            >
              {commScore.toFixed(1)}
            </div>
          ) : (
            <div className="w-14 h-14 mx-auto rounded-full border-2 border-gray-200 bg-gray-50 flex items-center justify-center font-bold text-lg text-gray-400">
              --
            </div>
          )}
          <div className="flex items-center justify-center gap-1 mt-2">
            <MessageSquare className="w-3 h-3 text-gray-400" />
            <p className="text-xs font-medium text-gray-600">Comm</p>
          </div>
        </div>

        {/* MDM Score */}
        <div className="text-center">
          {mdmScore != null ? (
            <div
              className={`w-14 h-14 mx-auto rounded-full border-2 flex items-center justify-center font-bold text-lg ${getScoreColor(mdmScore)}`}
            >
              {mdmScore.toFixed(1)}
            </div>
          ) : (
            <div className="w-14 h-14 mx-auto rounded-full border-2 border-gray-200 bg-gray-50 flex items-center justify-center font-bold text-lg text-gray-400">
              --
            </div>
          )}
          <div className="flex items-center justify-center gap-1 mt-2">
            <Brain className="w-3 h-3 text-gray-400" />
            <p className="text-xs font-medium text-gray-600">MDM</p>
          </div>
        </div>
      </div>

      {/* Case Goals */}
      {assignment.room?.case_goals && (
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-medium text-gray-700">Case Goals</h3>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            {assignment.room.case_goals}
          </p>
        </div>
      )}

      {/* Learning Objectives / Summary */}
      {assignment.learning_objectives && (
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-medium text-gray-700">How You Did</h3>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            {assignment.learning_objectives}
          </p>
        </div>
      )}

      {/* Feedback timestamp */}
      {assignment.feedback_generated_at && (
        <div className="text-xs text-gray-400 text-right pt-2 border-t">
          Generated {new Date(assignment.feedback_generated_at).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
