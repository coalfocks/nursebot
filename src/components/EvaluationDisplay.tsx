import { useState } from 'react';
import { ChevronDown, ChevronUp, Award, Brain, MessageSquare, Activity, AlertTriangle, CheckCircle, XCircle, Target, Zap } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'];

interface CommunicationBreakdown {
  information_sharing: {
    score: number;
    feedback: string;
  };
  responsive_communication: {
    score: number;
    feedback: string;
  };
  efficiency_deduction: {
    score: number;
    feedback: string;
    cau_count?: number;
    case_difficulty?: string;
  };
}

interface MDMBreakdown {
  labs_orders_quality: {
    score: number;
    feedback: string;
  };
  note_thought_process: {
    score: number;
    feedback: string;
  };
  safety_deduction: {
    score: number;
    feedback: string;
  };
}

interface EvaluationDisplayProps {
  assignment: Assignment;
  onRetryFeedback?: () => void;
}

export default function EvaluationDisplay({ assignment, onRetryFeedback }: EvaluationDisplayProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('communication');

  // Type assertion for new scoring columns
  const communicationScore = (assignment as any).communication_score;
  const mdmScore = (assignment as any).mdm_score;
  const communicationBreakdown = (assignment as any).communication_breakdown as CommunicationBreakdown | null;
  const mdmBreakdown = (assignment as any).mdm_breakdown as MDMBreakdown | null;
  const learningObjectives = (assignment as any).learning_objectives;
  const caseDifficulty = (assignment as any).case_difficulty || 'intermediate';

  // Only show when feedback is ready
  if (!['completed', 'bedside'].includes(assignment.status)) {
    return null;
  }

  if (!communicationScore && !mdmScore) {
    // Fallback to legacy feedback if new scoring not available
    return null;
  }

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const ScoreBadge = ({ score, maxScore = 5, label }: { score: number; maxScore?: number; label: string }) => {
    const percentage = (score / maxScore) * 100;
    const color = percentage >= 80 ? 'bg-green-100 text-green-800 border-green-300' :
                  percentage >= 60 ? 'bg-blue-100 text-blue-800 border-blue-300' :
                  percentage >= 40 ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
                  'bg-red-100 text-red-800 border-red-300';

    return (
      <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${color}`}>
        <span>{label}: </span>
        <span className="ml-1">{score.toFixed(1)}/{maxScore}</span>
      </div>
    );
  };

  const SubScoreRow = ({ 
    label, 
    score, 
    maxScore, 
    feedback,
    icon: Icon 
  }: { 
    label: string; 
    score: number; 
    maxScore: number;
    feedback: string;
    icon: React.ComponentType<{ className?: string }>;
  }) => {
    const percentage = (score / maxScore) * 100;
    const color = score < 0 ? 'text-red-600' :
                  percentage >= 80 ? 'text-green-600' :
                  percentage >= 60 ? 'text-blue-600' :
                  percentage >= 40 ? 'text-yellow-600' :
                  'text-red-600';

    return (
      <div className="border-l-4 border-gray-200 pl-4 py-2 mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 ${color}`} />
            <span className="font-medium text-gray-900">{label}</span>
          </div>
          <span className={`font-bold ${color}`}>
            {score >= 0 ? '+' : ''}{score}/{maxScore}
          </span>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{feedback}</p>
      </div>
    );
  };

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      {/* Header with Overall Scores */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Award className="w-7 h-7" />
              Performance Evaluation
            </h2>
            <p className="text-blue-100 mt-1">
              Case Difficulty: <span className="font-semibold capitalize">{caseDifficulty}</span>
            </p>
          </div>
          <div className="flex gap-4">
            {communicationScore !== undefined && (
              <div className="text-center">
                <div className="bg-white/20 rounded-lg px-4 py-2">
                  <div className="text-3xl font-bold text-white">
                    {communicationScore.toFixed(1)}
                  </div>
                  <div className="text-xs text-blue-100 uppercase tracking-wide">Communication</div>
                </div>
              </div>
            )}
            {mdmScore !== undefined && (
              <div className="text-center">
                <div className="bg-white/20 rounded-lg px-4 py-2">
                  <div className="text-3xl font-bold text-white">
                    {mdmScore.toFixed(1)}
                  </div>
                  <div className="text-xs text-blue-100 uppercase tracking-wide">Medical Decision</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Learning Objectives */}
      {learningObjectives && (
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
          <div className="flex items-start gap-2">
            <Target className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-1">Learning Objectives</h3>
              <p className="text-sm text-blue-800">{learningObjectives}</p>
            </div>
          </div>
        </div>
      )}

      {/* Communication Breakdown */}
      {communicationBreakdown && (
        <div className="border-b border-gray-200">
          <button
            onClick={() => toggleSection('communication')}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
          >
            <div className="flex items-center gap-3">
              <MessageSquare className="w-6 h-6 text-indigo-600" />
              <div className="text-left">
                <h3 className="text-lg font-semibold text-gray-900">Communication Score</h3>
                <p className="text-sm text-gray-500">
                  Raw: {(
                    communicationBreakdown.information_sharing.score +
                    communicationBreakdown.responsive_communication.score +
                    communicationBreakdown.efficiency_deduction.score
                  ).toFixed(1)} → Final: {communicationScore?.toFixed(1)}/5
                </p>
              </div>
            </div>
            {expandedSection === 'communication' ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>

          {expandedSection === 'communication' && (
            <div className="px-6 pb-6 space-y-2">
              <SubScoreRow
                label="Information Sharing"
                score={communicationBreakdown.information_sharing.score}
                maxScore={2}
                feedback={communicationBreakdown.information_sharing.feedback}
                icon={Activity}
              />
              <SubScoreRow
                label="Responsive Communication"
                score={communicationBreakdown.responsive_communication.score}
                maxScore={3}
                feedback={communicationBreakdown.responsive_communication.feedback}
                icon={MessageSquare}
              />
              <SubScoreRow
                label="Efficiency Deduction"
                score={communicationBreakdown.efficiency_deduction.score}
                maxScore={0}
                feedback={`${communicationBreakdown.efficiency_deduction.feedback}${communicationBreakdown.efficiency_deduction.cau_count ? ` (CAUs: ${communicationBreakdown.efficiency_deduction.cau_count})` : ''}`}
                icon={Zap}
              />
            </div>
          )}
        </div>
      )}

      {/* MDM Breakdown */}
      {mdmBreakdown && (
        <div className="border-b border-gray-200">
          <button
            onClick={() => toggleSection('mdm')}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
          >
            <div className="flex items-center gap-3">
              <Brain className="w-6 h-6 text-purple-600" />
              <div className="text-left">
                <h3 className="text-lg font-semibold text-gray-900">Medical Decision Making</h3>
                <p className="text-sm text-gray-500">
                  Raw: {(
                    mdmBreakdown.labs_orders_quality.score +
                    mdmBreakdown.note_thought_process.score +
                    mdmBreakdown.safety_deduction.score
                  ).toFixed(1)} → Final: {mdmScore?.toFixed(1)}/5
                </p>
              </div>
            </div>
            {expandedSection === 'mdm' ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>

          {expandedSection === 'mdm' && (
            <div className="px-6 pb-6 space-y-2">
              <SubScoreRow
                label="Labs/Orders Quality"
                score={mdmBreakdown.labs_orders_quality.score}
                maxScore={3}
                feedback={mdmBreakdown.labs_orders_quality.feedback}
                icon={Activity}
              />
              <SubScoreRow
                label="Progress Note Thought Process"
                score={mdmBreakdown.note_thought_process.score}
                maxScore={2}
                feedback={mdmBreakdown.note_thought_process.feedback}
                icon={Brain}
              />
              <SubScoreRow
                label="Safety Deduction"
                score={mdmBreakdown.safety_deduction.score}
                maxScore={0}
                feedback={mdmBreakdown.safety_deduction.feedback}
                icon={AlertTriangle}
              />
            </div>
          )}
        </div>
      )}

      {/* Score Calculation Formula */}
      <div className="px-6 py-4 bg-gray-50 text-xs text-gray-500">
        <p><strong>Scoring Formula:</strong></p>
        <p>Communication = clamp(Information Sharing (0-2) + Responsive Communication (0-3) + Efficiency Deduction (-2 to 0), 0, 5)</p>
        <p>MDM = clamp(Labs/Orders (0-3) + Note Thought Process (0-2) + Safety Deduction (-2 to 0), 0, 5)</p>
      </div>
    </div>
  );
}
