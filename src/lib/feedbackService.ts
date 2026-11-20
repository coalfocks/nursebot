import { supabase } from './supabase';
import { isFeedbackEligibleStatus } from './feedbackEligibility';

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

// supabase-js reports any non-2xx edge response as the generic
// "Edge Function returned a non-2xx status code", which hides the real server
// error (the edge function already persists its own message to feedback_error).
// Read the JSON body the function returned so the learner/admin sees the cause.
export async function readFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : 'Failed to generate feedback';
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown } | null;
      if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
    } catch {
      // Body was not JSON; fall back to the client-side message.
    }
  }
  return fallback;
}

export async function generateFeedback(assignmentId: string): Promise<void> {
  try {
    const { data: assignment, error: assignmentError } = await supabase
      .from('student_room_assignments')
      .select('status')
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError) throw assignmentError;
    if (!assignment || !isFeedbackEligibleStatus(assignment.status)) {
      throw new Error('Cannot generate feedback until the assignment is completed');
    }

    // Preserve the prior assessment while a new versioned run is generated.
    const { error: resetError } = await supabase
      .from('student_room_assignments')
      .update({ 
        feedback_status: 'pending',
        feedback_error: null,
        // Do not clear the prior feedback: reruns must not erase audit history or leave a blank shell.
      })
      .eq('id', assignmentId);

    if (resetError) throw resetError;

    // Then invoke the Edge Function
    const { data, error } = await supabase.functions.invoke('generate-feedback', {
      body: { assignmentId }
    });

    if (error) {
      // If there's an error, update the status to failed with the server's real message
      const message = await readFunctionErrorMessage(error);
      await supabase
        .from('student_room_assignments')
        .update({ 
          feedback_status: 'failed',
          feedback_error: message
        })
        .eq('id', assignmentId);
      throw new Error(message);
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

export interface CheckPendingFeedbackOptions {
  /** null/undefined = all pending completed assignments; [] = nothing; otherwise only these assignment IDs. */
  assignmentIds?: string[] | null;
}

export async function checkPendingFeedback(options: CheckPendingFeedbackOptions = {}): Promise<void> {
  const scope = options.assignmentIds ?? null;
  if (scope && scope.length === 0) return;

  let query = supabase
    .from('student_room_assignments')
    .select('id')
    .eq('feedback_status', 'pending')
    .eq('status', 'completed');
  if (scope) query = query.in('id', scope);
  const { data: pendingAssignments, error } = await query;

  if (error) {
    console.error('Error checking pending feedback:', error);
    return;
  }

  for (const assignment of pendingAssignments ?? []) {
    try {
      await generateFeedback(assignment.id);
      // Add a small delay between processing assignments to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error generating feedback for assignment ${assignment.id}:`, error);
    }
  }
}
