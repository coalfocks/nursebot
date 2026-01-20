import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIMEOUT_MS = 60000; // Increase timeout to 60 seconds

interface FeedbackResponse {
  summary: string;
  overall_score: number;
  clinical_reasoning: {
    score: number;
    comments: string;
    strengths: string[];
    areas_for_improvement: string[];
  };
  communication_skills: {
    score: number;
    comments: string;
    strengths: string[];
    areas_for_improvement: string[];
  };
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
          student:student_id (
            specialization_interest
          ),
          room:room_id (
            *,
            specialty_id,
            specialty_ids
          )
        `)
        .eq('id', assignmentId)
        .single();

      if (assignmentError) {
        console.error('Error fetching assignment:', assignmentError);
        throw assignmentError;
      }

      // Verify assignment is completed before generating feedback
      if (!['completed', 'bedside'].includes(assignment.status)) {
        console.error('Cannot generate feedback for incomplete assignment:', {
          assignmentId,
          status: assignment.status
        });
        throw new Error('Cannot generate feedback for incomplete assignment');
      }

      console.log('Fetched assignment details');

      // Fetch specialty names if specialty_ids exist
      let specialtyNames: string[] = [];
      if (assignment.room.specialty_ids && assignment.room.specialty_ids.length > 0) {
        const { data: specialties } = await supabaseClient
          .from('specialties')
          .select('name')
          .in('id', assignment.room.specialty_ids);
        specialtyNames = specialties?.map(s => s.name) || [];
      } else if (assignment.room.specialty_id) {
        const { data: specialty } = await supabaseClient
          .from('specialties')
          .select('name')
          .eq('id', assignment.room.specialty_id)
          .single();
        if (specialty) specialtyNames = [specialty.name];
      }

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
      const caseDesignationLine = assignment.student?.specialization_interest
        ? `Case Designation: ${assignment.student.specialization_interest}`
        : '';

      const context = `
Room Information:
Specialty: ${specialtyNames.length > 0 ? specialtyNames.join(', ') : 'General'}
Difficulty Level: ${assignment.room.difficulty_level || 'Not specified'}
Expected Diagnosis: ${JSON.stringify(assignment.room.expected_diagnosis)}
Expected Treatment: ${JSON.stringify(assignment.room.expected_treatment)}

${caseDesignationLine ? `Student Profile:\n${caseDesignationLine}\n` : ''}

Student's Diagnosis: ${assignment.diagnosis || 'Not provided'}
Student's Treatment Plan: ${assignment.treatment_plan || 'Not provided'}

Conversation:
${conversation}
`;

      console.log('Prepared context, generating feedback with OpenAI');
      console.log('Context length:', context.length);

      // Generate feedback using OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an experienced nurse educator providing detailed feedback on student performance. You must evaluate BOTH areas: Clinical Reasoning and Communication Skills with equal attention and detail. Each section must have a score, comments, strengths, and areas for improvement."
          },
          {
            role: "user",
            content: `
**Prompt for Evaluation of Medical Student Responses to Text-Based Pages**
When evaluating medical student performance in responding to clinical pages or text messages,
please use the following detailed scale (1 to 5). This evaluation is specifically designed
considering the student's preparation level as a fourth-year medical student transitioning toward
internship. As active listening responses are limited due to the text-based format, they emphasize
concise yet complete clinical decision-making, focused questioning, clarity of medical
explanations, diagnostic reasoning, patient care planning, appropriate demonstration of medical
knowledge, professional tone, timeliness of follow-up, and overall practical communication
suitable for short interactions via paging systems.
---
**Scoring Criteria**
Each student response should be evaluated in detail across three key domains:
### 1. Clinical Reasoning
Assess the student's ability to think critically through clinical scenarios, use relevant medical
knowledge, demonstrate sound diagnostic approaches, and propose appropriate next steps in
patient management.
- **Score 1 (Poor):**
- Limited clinical judgment, inappropriate or incomplete assessments.
- Neglects key patient information or significant clinical details.
- No clear diagnostic strategy, or incorrect/inappropriate proposed management.
- **Score 2 (Below Average):**
- Minimal clinical reasoning skills shown with partial relevance.
- Makes superficial assessments, overlooks critical aspects of patient's clinical presentation or
data.
- Inadequate clinical reasoning leads to very limited or vague management plans.
- **Score 3 (Average):**
- Demonstrates reasonable, standard clinical reasoning for their level.
- Appropriately identifies main clinical concerns but misses some subtleties.
- Provides acceptable but generic management plans, missing nuance or depth.
- **Score 4 (Very Good):**
- Consistently shows sound clinical reasoning aligned with level of intern.
- Clearly identifies key clinical issues, effectively prioritizes them, and proposes thoughtful next
steps in diagnosis or management.
- Demonstrates evidence-based thinking and appropriate use of medical knowledge.
- **Score 5 (Excellent):**
- Outstanding clinical reasoning reflective of early intern-level competence and decision making.
- Quickly identifies critical clinical issues, relevant differential diagnoses, and articulates concise
and effective management proposals along with well-considered follow-up steps.
- Demonstrates advanced reasoning beyond typical student expectations, utilizing comprehensive
medical knowledge actively in responses.
### 2. Communication Skills
Assess the students' clarity, conciseness, ability to explain clinical reasoning and medical
concepts without confusion or ambiguity, and their capability in asking targeted and relevant
follow-up questions through short messaging.
- **Score 1 (Poor):**
- Unclear, confusing responses with frequent inaccuracies.
- Ineffective questioning or follow-up communication; no relevant clarification or details
provided.
- Communication completely unsuitable for paging or messaging format.
- **Score 2 (Below Average):**
- Responses show limited clarity; occasional confusion for the recipient.
- Questions are minimal or inappropriate, lacking direction or relevance.
- Responses not well-adapted to short, concise paging interactions.
- **Score 3 (Average):**
- Generally clear communication, but may include unnecessary information or lacks proper
conciseness.
- Adequately relevant follow-up questions, but occasionally missing important points.
- Adequate for pages, but room remains for improved efficiency and clarity.
- **Score 4 (Very Good):**
- Clear and appropriate communication, generally concise and efficient.
- Effectively asks meaningful questions specific to clinical context, facilitating diagnostic and
management clarity.
- Responses typically clear, medically accurate, and adapted well for short messaging
interactions.
- **Score 5 (Excellent):**
- Superior communication quality: consistently clear, succinct, and precise.
- Exceptional skill in formulating questions and follow-up communications, directly relevant to
clinical scenario.
- Ideals for paging: responses are highly effective, precise, and demonstrate a mature
understanding of clinical and practical information exchange.
### Overall Performance Scoring (1–5)
Assign an overall numerical score based on collective evaluation from above criteria, reflecting
an integrated assessment of the student's readiness approaching internship level.
---
### Feedback Guidelines
Provide detailed evaluation structured in JSON format clearly, including each of these required
components for each area (Clinical Reasoning, Communication Skills):
- Numeric Score
- Detailed Comments (at least 2–3 sentences)
- At least 2–3 Key Strengths
- At least 2–3 Areas for Improvement

Additionally, include:
- **Short summary** explicitly stating student's overall performance.
- **Specific Recommendations** for areas requiring further improvement targeted toward intern
preparedness.
---

Context of the interaction (the first message is from the nurse to the doctor):
${context}

Provide your evaluation in a structured JSON format matching this TypeScript interface:

interface FeedbackResponse {
  summary: string;
  overall_score: number;
  clinical_reasoning: {
    score: number;
    comments: string;
    strengths: string[];
    areas_for_improvement: string[];
  };
  communication_skills: {
    score: number;
    comments: string;
    strengths: string[];
    areas_for_improvement: string[];
  };
  recommendations: string[];
}

IMPORTANT: You MUST provide detailed feedback for BOTH areas (Clinical Reasoning and Communication Skills). Do not focus on just one area.

**Final Note:**
Keep in mind the audience and context – these are fourth-year medical students at the cusp of
becoming residents/interns. Feedback should be constructive, simple, specific, actionable, direct,
and aimed at identifying priority areas for focused growth to ensure readiness and effectiveness
in their upcoming clinical roles.`
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
      if (!feedback.clinical_reasoning || !feedback.communication_skills) {
        console.error('Feedback response missing required sections:', {
          hasClinicalReasoning: !!feedback.clinical_reasoning,
          hasCommunication: !!feedback.communication_skills
        });
        throw new Error('Feedback response missing required sections');
      }

      // Validate each section has required fields
      const validateSection = (section: any, name: string) => {
        if (!section.score || !section.comments || !section.strengths || !section.areas_for_improvement) {
          console.error(`Missing required fields in ${name} section:`, section);
          throw new Error(`Missing required fields in ${name} section`);
        }
      };

      validateSection(feedback.clinical_reasoning, 'clinical_reasoning');
      validateSection(feedback.communication_skills, 'communication_skills');

      // Validate overall feedback
      if (!feedback.overall_score || !feedback.summary || !feedback.recommendations) {
        console.error('Missing required fields in overall feedback:', feedback);
        throw new Error('Missing required fields in overall feedback');
      }

      console.log('Successfully validated feedback structure');
      console.log('Feedback sections:', {
        clinicalReasoning: {
          score: feedback.clinical_reasoning.score,
          strengthsCount: feedback.clinical_reasoning.strengths.length,
          areasCount: feedback.clinical_reasoning.areas_for_improvement.length
        },
        communication: {
          score: feedback.communication_skills.score,
          strengthsCount: feedback.communication_skills.strengths.length,
          areasCount: feedback.communication_skills.areas_for_improvement.length
        },
        overallScore: feedback.overall_score,
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
    try {
      await Promise.race([mainPromise, timeoutPromise]);
    } catch (error) {
      console.error('Error in feedback generation:', error);
      throw error;
    }

    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in generate-feedback function:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    });
    
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
