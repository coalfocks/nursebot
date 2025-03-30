import { useState } from 'react';
import { ChevronDown, ChevronUp, Award, Brain, MessageSquare, UserCircle, Loader2 } from 'lucide-react';
import type { Database } from '../lib/database.types';

type Assignment = Database['public']['Tables']['student_room_assignments']['Row'] & {
  room?: Database['public']['Tables']['rooms']['Row'] & {
    specialty?: {
      name: string;
    };
  };
};

interface AssignmentFeedbackProps {
  assignment: Assignment;
  onRetryFeedback?: () => void;
}

export default function AssignmentFeedback({ assignment, onRetryFeedback }: AssignmentFeedbackProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Only show feedback when status is completed
  if (assignment.status !== 'completed') {
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

  if (!assignment.nurse_feedback) {
    console.log('No nurse feedback available for assignment:', assignment.id);
    return null;
  }

  const feedback = assignment.nurse_feedback;
  console.log('Rendering feedback for assignment:', assignment.id, {
    hasClinicalReasoning: !!feedback.clinicalReasoning,
    hasCommunication: !!feedback.communication,
    hasProfessionalism: !!feedback.professionalism,
    overallScore: feedback.overallScore,
    summary: feedback.summary?.substring(0, 50) + '...',
    recommendationsCount: feedback.recommendations?.length
  });

  // Add null checks for each section
  const clinicalReasoning = feedback.clinicalReasoning || {
    score: 0,
    comments: '',
    strengths: [],
    areasForImprovement: []
  };

  const communication = feedback.communication || {
    score: 0,
    comments: '',
    strengths: [],
    areasForImprovement: []
  };

  const professionalism = feedback.professionalism || {
    score: 0,
    comments: '',
    strengths: [],
    areasForImprovement: []
  };

  console.log('Processed feedback sections:', {
    clinicalReasoning: {
      score: clinicalReasoning.score,
      strengthsCount: clinicalReasoning.strengths.length,
      areasCount: clinicalReasoning.areasForImprovement.length
    },
    communication: {
      score: communication.score,
      strengthsCount: communication.strengths.length,
      areasCount: communication.areasForImprovement.length
    },
    professionalism: {
      score: professionalism.score,
      strengthsCount: professionalism.strengths.length,
      areasCount: professionalism.areasForImprovement.length
    }
  });

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const ScoreIndicator = ({ score }: { score: number }) => (
    <div className="flex items-center space-x-2">
      <div className="w-16 h-16 rounded-full border-4 flex items-center justify-center font-bold text-xl"
        style={{
          borderColor: score >= 4.5 ? '#22c55e' : score >= 3.5 ? '#3b82f6' : score >= 2.5 ? '#f59e0b' : '#ef4444',
          color: score >= 4.5 ? '#22c55e' : score >= 3.5 ? '#3b82f6' : score >= 2.5 ? '#f59e0b' : '#ef4444',
        }}
      >
        {score.toFixed(1)}
      </div>
    </div>
  );

  const FeedbackSection = ({ 
    title, 
    icon: Icon, 
    score, 
    comments, 
    strengths, 
    areasForImprovement,
    sectionKey,
  }: { 
    title: string;
    icon: any;
    score: number;
    comments: string;
    strengths: string[];
    areasForImprovement: string[];
    sectionKey: string;
  }) => {
    // Ensure arrays are defined
    const safeStrengths = strengths || [];
    const safeAreasForImprovement = areasForImprovement || [];
    
    return (
      <div className="border rounded-lg p-4">
        <button
          onClick={() => toggleSection(sectionKey)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            <Icon className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-medium">{title}</h3>
          </div>
          <div className="flex items-center space-x-4">
            <ScoreIndicator score={score} />
            {expandedSection === sectionKey ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </div>
        </button>

        {expandedSection === sectionKey && (
          <div className="mt-4 space-y-4">
            <p className="text-gray-700">{comments || ''}</p>
            
            {safeStrengths.length > 0 && (
              <div>
                <h4 className="font-medium text-green-700 mb-2">Strengths</h4>
                <ul className="list-disc list-inside space-y-1">
                  {safeStrengths.map((strength, index) => (
                    <li key={index} className="text-gray-600">{strength}</li>
                  ))}
                </ul>
              </div>
            )}

            {safeAreasForImprovement.length > 0 && (
              <div>
                <h4 className="font-medium text-amber-700 mb-2">Areas for Improvement</h4>
                <ul className="list-disc list-inside space-y-1">
                  {safeAreasForImprovement.map((area, index) => (
                    <li key={index} className="text-gray-600">{area}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white shadow rounded-lg p-6 space-y-6">
      <div className="border-b pb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Performance Feedback</h2>
          <ScoreIndicator score={feedback.overallScore || 0} />
        </div>
        <p className="text-gray-700">{feedback.summary || ''}</p>
      </div>

      <div className="space-y-4">
        <FeedbackSection
          title="Clinical Reasoning"
          icon={Brain}
          score={clinicalReasoning.score}
          comments={clinicalReasoning.comments}
          strengths={clinicalReasoning.strengths}
          areasForImprovement={clinicalReasoning.areasForImprovement}
          sectionKey="clinical"
        />

        <FeedbackSection
          title="Communication Skills"
          icon={MessageSquare}
          score={communication.score}
          comments={communication.comments}
          strengths={communication.strengths}
          areasForImprovement={communication.areasForImprovement}
          sectionKey="communication"
        />

        <FeedbackSection
          title="Professionalism"
          icon={UserCircle}
          score={professionalism.score}
          comments={professionalism.comments}
          strengths={professionalism.strengths}
          areasForImprovement={professionalism.areasForImprovement}
          sectionKey="professionalism"
        />
      </div>

      <div className="border-t pt-4">
        <h3 className="text-lg font-medium mb-3 flex items-center">
          <Award className="w-5 h-5 mr-2 text-amber-600" />
          Recommendations
        </h3>
        <ul className="list-disc list-inside space-y-2">
          {(feedback.recommendations || []).map((recommendation, index) => (
            <li key={index} className="text-gray-700">{recommendation}</li>
          ))}
        </ul>
      </div>

      {assignment.feedback_generated_at && (
        <div className="text-xs text-gray-500 text-right">
          Generated on {new Date(assignment.feedback_generated_at).toLocaleString()}
        </div>
      )}
    </div>
  );
} 