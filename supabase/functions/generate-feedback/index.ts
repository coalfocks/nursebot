import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FeedbackResponse {
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

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { assignmentId } = await req.json();
    
    if (!assignmentId) {
      return new Response(
        JSON.stringify({ error: 'Assignment ID is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
    });

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Update status to processing
    await supabaseClient
      .from('student_room_assignments')
      .update({ feedback_status: 'processing' })
      .eq('id', assignmentId);

    // Fetch assignment details
    const { data: assignment, error: assignmentError } = await supabaseClient
      .from('student_room_assignments')
      .select(`
        *,
        room:room_id (
          *,
          specialty:specialty_id (name)
        )
      `)
      .eq('id', assignmentId)
      .single();

    if (assignmentError) throw assignmentError;

    // Fetch chat messages
    const { data: messages, error: messagesError } = await supabaseClient
      .from('chat_messages')
      .select('*')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    // Prepare conversation context
    const conversation = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n');
    const context = `
Room Information:
Specialty: ${assignment.room.specialty?.name || 'General'}
Difficulty Level: ${assignment.room.difficulty_level || 'Not specified'}
Expected Diagnosis: ${JSON.stringify(assignment.room.expected_diagnosis)}
Expected Treatment: ${JSON.stringify(assignment.room.expected_treatment)}

Student's Diagnosis: ${assignment.diagnosis || 'Not provided'}
Student's Treatment Plan: ${assignment.treatment_plan || 'Not provided'}

Conversation:
${conversation}
`;

    // Generate feedback using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are an experienced nurse educator providing detailed feedback on student performance. You must evaluate ALL THREE areas: Clinical Reasoning, Communication Skills, and Professionalism with equal attention and detail."
        },
        {
          role: "user",
          content: `
You are an experienced nurse educator evaluating a student's performance in a simulated patient interaction. 
Please analyze the following conversation and provide DETAILED feedback in ALL THREE of these areas:

1. Clinical Reasoning (Score 1-5): Evaluate the student's ability to analyze patient data, identify problems, and develop appropriate care plans. Consider their critical thinking, assessment skills, and clinical decision-making.

2. Communication Skills (Score 1-5): Evaluate how effectively the student communicates with the patient. Consider clarity, empathy, active listening, and ability to explain medical concepts.

3. Professionalism (Score 1-5): Evaluate the student's professional behavior. Consider respect, ethics, responsibility, and adherence to nursing standards.

For EACH of these three areas, you MUST provide:
- A numeric score (1-5)
- Specific comments (at least 2-3 sentences)
- At least 2-3 key strengths
- At least 2-3 areas for improvement

Also include:
- An overall score (1-5) that considers all three areas
- A summary of the student's overall performance
- Specific recommendations for improvement

Context of the interaction:
${context}

Provide your evaluation in a structured JSON format matching this TypeScript interface:

interface FeedbackResponse {
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

IMPORTANT: You MUST provide detailed feedback for ALL THREE areas (Clinical Reasoning, Communication Skills, and Professionalism). Do not focus on just one area.`
        }
      ],
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error('No response content received from OpenAI');
    }

    const feedback = JSON.parse(content) as FeedbackResponse;

    // Update assignment with feedback
    await supabaseClient
      .from('student_room_assignments')
      .update({
        nurse_feedback: feedback,
        feedback_status: 'completed',
        feedback_generated_at: new Date().toISOString()
      })
      .eq('id', assignmentId);

    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error:', error);
    
    // If we have an assignmentId, update the status
    try {
      const { assignmentId } = await req.json();
      if (assignmentId) {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        
        await supabaseClient
          .from('student_room_assignments')
          .update({
            feedback_status: 'failed',
            feedback_error: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', assignmentId);
      }
    } catch (e) {
      console.error('Error updating assignment status:', e);
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}); 