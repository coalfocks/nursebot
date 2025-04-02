import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIMEOUT_MS = 60000; // Increase timeout to 60 seconds

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

async function updateAssignmentStatus(
  supabaseClient: any,
  assignmentId: string,
  status: 'processing' | 'completed' | 'failed',
  error?: string
) {
  const updateData: any = { feedback_status: status };
  if (error) updateData.feedback_error = error;
  if (status === 'completed') updateData.feedback_generated_at = new Date().toISOString();

  const { error: updateError } = await supabaseClient
    .from('student_room_assignments')
    .update(updateData)
    .eq('id', assignmentId);

  if (updateError) {
    console.error('Error updating assignment status:', updateError);
    throw updateError;
  }
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

    console.log(`Starting feedback generation for assignment ${assignmentId}`);

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
    });

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Set up timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Feedback generation timed out')), TIMEOUT_MS);
    });

    // Main function promise
    const mainPromise = (async () => {
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

      if (assignmentError) {
        console.error('Error fetching assignment:', assignmentError);
        throw assignmentError;
      }

      console.log('Fetched assignment details');

      // Fetch chat messages
      const { data: messages, error: messagesError } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true });

      if (messagesError) {
        console.error('Error fetching messages:', messagesError);
        throw messagesError;
      }

      console.log(`Fetched ${messages.length} messages`);

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

      console.log('Prepared context, generating feedback with OpenAI');
      console.log('Context length:', context.length);

      // Generate feedback using OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: "You are an experienced nurse educator providing detailed feedback on student performance. You must evaluate ALL THREE areas: Clinical Reasoning, Communication Skills, and Professionalism with equal attention and detail. Each section must have a score, comments, strengths, and areas for improvement."
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
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 2000
      });

      console.log('Received response from OpenAI');
      console.log('Response length:', completion.choices[0].message.content?.length);

      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('No response content received from OpenAI');
      }

      console.log('Parsing OpenAI response');
      const feedback = JSON.parse(content) as FeedbackResponse;
      
      // Validate feedback structure
      if (!feedback.clinicalReasoning || !feedback.communication || !feedback.professionalism) {
        console.error('Feedback response missing required sections:', {
          hasClinicalReasoning: !!feedback.clinicalReasoning,
          hasCommunication: !!feedback.communication,
          hasProfessionalism: !!feedback.professionalism
        });
        throw new Error('Feedback response missing required sections');
      }

      // Validate each section has required fields
      const validateSection = (section: any, name: string) => {
        if (!section.score || !section.comments || !section.strengths || !section.areasForImprovement) {
          console.error(`Missing required fields in ${name} section:`, section);
          throw new Error(`Missing required fields in ${name} section`);
        }
      };

      validateSection(feedback.clinicalReasoning, 'clinicalReasoning');
      validateSection(feedback.communication, 'communication');
      validateSection(feedback.professionalism, 'professionalism');

      // Validate overall feedback
      if (!feedback.overallScore || !feedback.summary || !feedback.recommendations) {
        console.error('Missing required fields in overall feedback:', feedback);
        throw new Error('Missing required fields in overall feedback');
      }

      console.log('Successfully validated feedback structure');
      console.log('Feedback sections:', {
        clinicalReasoning: {
          score: feedback.clinicalReasoning.score,
          strengthsCount: feedback.clinicalReasoning.strengths.length,
          areasCount: feedback.clinicalReasoning.areasForImprovement.length
        },
        communication: {
          score: feedback.communication.score,
          strengthsCount: feedback.communication.strengths.length,
          areasCount: feedback.communication.areasForImprovement.length
        },
        professionalism: {
          score: feedback.professionalism.score,
          strengthsCount: feedback.professionalism.strengths.length,
          areasCount: feedback.professionalism.areasForImprovement.length
        },
        overallScore: feedback.overallScore,
        recommendationsCount: feedback.recommendations.length
      });

      // Update assignment with feedback
      const { error: updateError } = await supabaseClient
        .from('student_room_assignments')
        .update({
          nurse_feedback: feedback,
          feedback_status: 'completed',
          feedback_generated_at: new Date().toISOString()
        })
        .eq('id', assignmentId);

      if (updateError) {
        console.error('Error updating assignment with feedback:', updateError);
        throw updateError;
      }

      console.log('Successfully updated assignment with feedback');
    })();

    // Race between timeout and main function
    await Promise.race([mainPromise, timeoutPromise]);

    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in generate-feedback function:', error);
    
    // If we have an assignmentId, update the status
    try {
      const { assignmentId } = await req.json();
      if (assignmentId) {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        
        await updateAssignmentStatus(
          supabaseClient,
          assignmentId,
          'failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
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