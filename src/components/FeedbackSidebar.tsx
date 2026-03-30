import { useState } from 'react';
import {
  Award,
  MessageSquare,
  Brain,
  Target,
  Lightbulb,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { Database, Json } from '../lib/database.types';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room?: Database['public']['Tables']['rooms']['Row'];
};

interface FeedbackSidebarProps {
  assignment: Assignment;
}

type BreakdownItem = {
  score: number | null;
  feedback: string | null;
};

type EfficiencyBreakdownItem = BreakdownItem & {
  cau_count?: number | null;
  case_difficulty?: string | null;
};

type CommunicationBreakdown = {
  information_sharing?: BreakdownItem;
  responsive_communication?: BreakdownItem;
  efficiency_deduction?: EfficiencyBreakdownItem;
};

type MdmBreakdown = {
  labs_orders_quality?: BreakdownItem;
  note_thought_process?: BreakdownItem;
  safety_deduction?: BreakdownItem;
};

const isRecord = (value: Json | null): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toBreakdownItem = (value: Json | undefined): BreakdownItem | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const scoreValue = value.score;
  const feedbackValue = value.feedback;

  return {
    score: typeof scoreValue === 'number' ? scoreValue : null,
    feedback: typeof feedbackValue === 'string' ? feedbackValue : null,
  };
};

const toEfficiencyItem = (value: Json | undefined): EfficiencyBreakdownItem | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const base = toBreakdownItem(value);
  const cauValue = value.cau_count;
  const difficultyValue = value.case_difficulty;

  return {
    score: base?.score ?? null,
    feedback: base?.feedback ?? null,
    cau_count: typeof cauValue === 'number' ? cauValue : null,
    case_difficulty: typeof difficultyValue === 'string' ? difficultyValue : null,
  };
};

const parseCommunicationBreakdown = (value: Json | null): CommunicationBreakdown | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    information_sharing: toBreakdownItem(value.information_sharing),
    responsive_communication: toBreakdownItem(value.responsive_communication),
    efficiency_deduction: toEfficiencyItem(value.efficiency_deduction),
  };
};

const parseMdmBreakdown = (value: Json | null): MdmBreakdown | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    labs_orders_quality: toBreakdownItem(value.labs_orders_quality),
    note_thought_process: toBreakdownItem(value.note_thought_process),
    safety_deduction: toBreakdownItem(value.safety_deduction),
  };
};

const scoreDisplay = (score: number | null | undefined) => (score == null ? '--' : String(score));

function BreakdownRow({
  title,
  range,
  item,
  extra,
}: {
  title: string;
  range: string;
  item?: BreakdownItem;
  extra?: { label: string; value: string | number }[];
}) {
  if (!item) return null;

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-700">{title}</p>
        <span className="text-xs font-semibold text-gray-900">
          {scoreDisplay(item.score)} <span className="text-gray-400">{range}</span>
        </span>
      </div>
      {item.feedback && <p className="mt-2 text-xs leading-relaxed text-gray-600">{item.feedback}</p>}
      {extra && extra.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {extra.map((entry) => (
            <span
              key={entry.label}
              className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600"
            >
              {entry.label}: {entry.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function FeedbackSidebar({ assignment }: FeedbackSidebarProps) {
  const [expandedSection, setExpandedSection] = useState<'communication' | 'mdm' | null>(null);

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

  // Check if we have actual feedback data (even if status is failed)
  // Prioritize actual data over status - if feedback exists, show it
  const hasFeedbackData = assignment.communication_score != null || assignment.mdm_score != null;

  // If we have feedback data, show it (even if status says failed)
  if (!hasFeedbackData) {
    // No feedback data yet - show error if failed
    if (assignment.feedback_status === 'failed') {
      return (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-center">
            <p className="text-sm text-red-600">Something went wrong generating feedback</p>
          </div>
        </div>
      );
    }
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

  const communicationBreakdown = parseCommunicationBreakdown(assignment.communication_breakdown);
  const mdmBreakdown = parseMdmBreakdown(assignment.mdm_breakdown);

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

      {/* Detailed Breakdown */}
      {communicationBreakdown && (
        <div className="border-t pt-4">
          <button
            type="button"
            onClick={() =>
              setExpandedSection(expandedSection === 'communication' ? null : 'communication')
            }
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-500" />
              <h3 className="text-sm font-medium text-gray-700">Communication Breakdown</h3>
            </div>
            {expandedSection === 'communication' ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>
          {expandedSection === 'communication' && (
            <div className="mt-3 space-y-2">
              <BreakdownRow
                title="Information Sharing"
                range="(0-2)"
                item={communicationBreakdown.information_sharing}
              />
              <BreakdownRow
                title="Responsive Communication"
                range="(0-3)"
                item={communicationBreakdown.responsive_communication}
              />
              <BreakdownRow
                title="Efficiency Deduction"
                range="(-2 to 0)"
                item={communicationBreakdown.efficiency_deduction}
                extra={[
                  communicationBreakdown.efficiency_deduction?.cau_count != null
                    ? {
                        label: 'CAU count',
                        value: communicationBreakdown.efficiency_deduction.cau_count,
                      }
                    : null,
                  communicationBreakdown.efficiency_deduction?.case_difficulty
                    ? {
                        label: 'Difficulty',
                        value: communicationBreakdown.efficiency_deduction.case_difficulty,
                      }
                    : null,
                ].filter((entry): entry is { label: string; value: string | number } => entry != null)}
              />
            </div>
          )}
        </div>
      )}

      {mdmBreakdown && (
        <div className="border-t pt-4">
          <button
            type="button"
            onClick={() => setExpandedSection(expandedSection === 'mdm' ? null : 'mdm')}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-indigo-500" />
              <h3 className="text-sm font-medium text-gray-700">MDM Breakdown</h3>
            </div>
            {expandedSection === 'mdm' ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </button>
          {expandedSection === 'mdm' && (
            <div className="mt-3 space-y-2">
              <BreakdownRow
                title="Labs/Orders Quality"
                range="(0-3)"
                item={mdmBreakdown.labs_orders_quality}
              />
              <BreakdownRow
                title="Note Thought Process"
                range="(0-2)"
                item={mdmBreakdown.note_thought_process}
              />
              <BreakdownRow
                title="Safety Deduction"
                range="(-2 to 0)"
                item={mdmBreakdown.safety_deduction}
              />
            </div>
          )}
        </div>
      )}

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
