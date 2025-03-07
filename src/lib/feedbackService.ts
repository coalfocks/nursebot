import { supabase } from './supabase';
import type { Database } from './database.types';

export interface FeedbackResponse {
  overallScore: number;
  clinicalReasoning: {
    score: number;
    comments: string;
    strengths: string[];
    areasForImprovement: string[];
  };
  communication: {
    score: number;
    comments: string;
    strengths: string[];
    areasForImprovement: string[];
  };
  professionalism: {
    score: number;
    comments: string;
    strengths: string[];
    areasForImprovement: string[];
  };
  summary: string;
  recommendations: string[];
}

export async function generateFeedback(assignmentId: string): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-feedback', {
      body: { assignmentId }
    });

    if (error) throw error;
    if (!data.success) throw new Error('Failed to generate feedback');

  } catch (error) {
    console.error('Error generating feedback:', error);
    throw error;
  }
}

export async function checkPendingFeedback(): Promise<void> {
  const { data: pendingAssignments, error } = await supabase
    .from('student_room_assignments')
    .select('id')
    .eq('feedback_status', 'pending');

  if (error) {
    console.error('Error checking pending feedback:', error);
    return;
  }

  for (const assignment of pendingAssignments) {
    try {
      await generateFeedback(assignment.id);
    } catch (error) {
      console.error(`Error generating feedback for assignment ${assignment.id}:`, error);
    }
  }
} 