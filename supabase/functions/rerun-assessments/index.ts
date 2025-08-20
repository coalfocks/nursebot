import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RerunRequest {
  assignment_ids?: string[]; // If provided, only rerun these specific assignments
  room_ids?: string[];       // If provided, only rerun assignments for these rooms
  rerun_all?: boolean;       // If true, rerun all completed assignments
}

interface RerunResponse {
  success: boolean;
  message: string;
  assignments_queued: number;
  assignment_ids: string[];
  errors?: string[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Starting rerun-assessments function');
    
    // Parse request body
    let requestBody: RerunRequest;
    try {
      requestBody = await req.json();
    } catch (error) {
      console.error('Error parsing request body:', error);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const { assignment_ids, room_ids, rerun_all } = requestBody;

    // Validate input - at least one option must be provided
    if (!assignment_ids && !room_ids && !rerun_all) {
      console.error('No valid rerun option provided');
      return new Response(
        JSON.stringify({ 
          error: 'Must provide assignment_ids, room_ids, or set rerun_all to true' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Fetching assignments to rerun based on criteria:', {
      assignment_ids: assignment_ids?.length || 0,
      room_ids: room_ids?.length || 0,
      rerun_all: !!rerun_all
    });

    // Build query to fetch assignments
    let query = supabaseClient
      .from('student_room_assignments')
      .select('id, room_id, student_id, status, feedback_status')
      .eq('status', 'completed'); // Only rerun completed assignments

    // Apply filters based on request
    if (assignment_ids && assignment_ids.length > 0) {
      query = query.in('id', assignment_ids);
    } else if (room_ids && room_ids.length > 0) {
      query = query.in('room_id', room_ids);
    }
    // If rerun_all is true, no additional filters needed

    const { data: assignments, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching assignments:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch assignments for rerun' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    if (!assignments || assignments.length === 0) {
      console.log('No eligible assignments found for rerun');
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'No eligible assignments found for rerun',
          assignments_queued: 0,
          assignment_ids: []
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`Found ${assignments.length} assignments to rerun`);

    const assignmentIds = assignments.map(a => a.id);
    const errors: string[] = [];
    let successCount = 0;

    // Reset feedback status to pending for all assignments
    console.log('Resetting feedback status to pending for all assignments');
    const { error: resetError } = await supabaseClient
      .from('student_room_assignments')
      .update({
        feedback_status: 'pending',
        feedback_error: null,
        nurse_feedback: null,
        feedback_generated_at: null
      })
      .in('id', assignmentIds);

    if (resetError) {
      console.error('Error resetting feedback status:', resetError);
      return new Response(
        JSON.stringify({ error: 'Failed to reset feedback status for assignments' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Successfully reset feedback status, now triggering individual feedback generation');

    // Trigger feedback generation for each assignment
    for (const assignment of assignments) {
      try {
        console.log(`Triggering feedback generation for assignment ${assignment.id}`);
        
        // Call the generate-feedback function for each assignment
        const { error: generateError } = await supabaseClient.functions.invoke('generate-feedback', {
          body: { assignmentId: assignment.id }
        });

        if (generateError) {
          console.error(`Error generating feedback for assignment ${assignment.id}:`, generateError);
          errors.push(`Assignment ${assignment.id}: ${generateError.message || 'Unknown error'}`);
          
          // Update the assignment status to failed
          await supabaseClient
            .from('student_room_assignments')
            .update({
              feedback_status: 'failed',
              feedback_error: generateError.message || 'Unknown error'
            })
            .eq('id', assignment.id);
        } else {
          console.log(`Successfully queued feedback generation for assignment ${assignment.id}`);
          successCount++;
        }
      } catch (error) {
        console.error(`Unexpected error for assignment ${assignment.id}:`, error);
        errors.push(`Assignment ${assignment.id}: ${error instanceof Error ? error.message : 'Unexpected error'}`);
        
        // Update the assignment status to failed
        try {
          await supabaseClient
            .from('student_room_assignments')
            .update({
              feedback_status: 'failed',
              feedback_error: error instanceof Error ? error.message : 'Unexpected error'
            })
            .eq('id', assignment.id);
        } catch (updateError) {
          console.error(`Failed to update error status for assignment ${assignment.id}:`, updateError);
        }
      }
    }

    const response: RerunResponse = {
      success: true,
      message: `Successfully queued ${successCount} of ${assignments.length} assignments for feedback regeneration`,
      assignments_queued: successCount,
      assignment_ids: assignmentIds,
      ...(errors.length > 0 && { errors })
    };

    console.log('Rerun operation completed:', response);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in rerun-assessments function:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });

    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        success: false
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});