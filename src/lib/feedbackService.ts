import { supabase } from './supabase';

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
  summary: string;
  recommendations: string[];
}

export async function generateFeedback(assignmentId: string): Promise<void> {
  try {
    // First, reset the status to pending and clear any previous errors
    const { error: resetError } = await supabase
      .from('student_room_assignments')
      .update({ 
        feedback_status: 'pending',
        feedback_error: null,
        nurse_feedback: null,
        feedback_generated_at: null
      })
      .eq('id', assignmentId);

    if (resetError) throw resetError;

    // Then invoke the Edge Function
    const { data, error } = await supabase.functions.invoke('generate-feedback', {
      body: { assignmentId }
    });

    if (error) {
      // If there's an error, update the status to failed
      await supabase
        .from('student_room_assignments')
        .update({ 
          feedback_status: 'failed',
          feedback_error: error.message
        })
        .eq('id', assignmentId);
      throw error;
    }

    if (!data.success) {
      // If the function returns but wasn't successful, update the status to failed
      await supabase
        .from('student_room_assignments')
        .update({ 
          feedback_status: 'failed',
          feedback_error: 'Failed to generate feedback'
        })
        .eq('id', assignmentId);
      throw new Error('Failed to generate feedback');
    }

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
      // Add a small delay between processing assignments to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error generating feedback for assignment ${assignment.id}:`, error);
    }
  }
} 
