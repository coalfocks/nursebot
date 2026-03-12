import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import {
  COMMUNICATION_SCORING,
  EVALUATION_SYSTEM_PROMPT,
  FEEDBACK_TEMPLATE,
  MDM_SCORING,
} from '../_shared/evaluation-prompts.ts';
import { canonicalizeEvaluation, type EvaluationScoringResponse } from '../_shared/evaluation-scoring.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIMEOUT_MS = 90000; // Increase timeout to 90 seconds for more complex scoring

// Legacy feedback response for backward compatibility
interface LegacyFeedbackResponse {
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

const rubricReferenceText = `Example feedback template:
${FEEDBACK_TEMPLATE}

Student Feedback Outline

Communication
${COMMUNICATION_SCORING.overview}

${COMMUNICATION_SCORING.informationSharing.label}
0: "${COMMUNICATION_SCORING.informationSharing.scores[0].feedback}"
1: "${COMMUNICATION_SCORING.informationSharing.scores[1].feedback}"
2: "${COMMUNICATION_SCORING.informationSharing.scores[2].feedback}"

${COMMUNICATION_SCORING.responsiveCommunication.label}
0: "${COMMUNICATION_SCORING.responsiveCommunication.scores[0].feedback}"
1: "${COMMUNICATION_SCORING.responsiveCommunication.scores[1].feedback}"
2: "${COMMUNICATION_SCORING.responsiveCommunication.scores[2].feedback}"
3: "${COMMUNICATION_SCORING.responsiveCommunication.scores[3].feedback}"

${COMMUNICATION_SCORING.efficiencyDeduction.label}
0: "${COMMUNICATION_SCORING.efficiencyDeduction.scores[0].feedback}"
-1: "${COMMUNICATION_SCORING.efficiencyDeduction.scores['-1'].feedback}"
-2: "${COMMUNICATION_SCORING.efficiencyDeduction.scores['-2'].feedback}"

Medical Decision Making
${MDM_SCORING.overview}

${MDM_SCORING.labsOrdersQuality.label}
0: "${MDM_SCORING.labsOrdersQuality.scores[0].feedback}"
1: "${MDM_SCORING.labsOrdersQuality.scores[1].feedback}"
2: "${MDM_SCORING.labsOrdersQuality.scores[2].feedback}"
3: "${MDM_SCORING.labsOrdersQuality.scores[3].feedback}"

${MDM_SCORING.noteThoughtProcess.label}
0: "${MDM_SCORING.noteThoughtProcess.scores[0].feedback}"
1: "${MDM_SCORING.noteThoughtProcess.scores[1].feedback}"
2: "${MDM_SCORING.noteThoughtProcess.scores[2].feedback}"

${MDM_SCORING.safetyDeduction.label}
0: "${MDM_SCORING.safetyDeduction.scores[0].feedback}"
-1: "${MDM_SCORING.safetyDeduction.scores['-1'].feedback}"
-2: "${MDM_SCORING.safetyDeduction.scores['-2'].feedback}"`;

async function updateAssignmentStatus(
  supabaseClient: ReturnType<typeof createClient>,
  assignmentId: string,
  status: 'processing' | 'completed' | 'failed',
  error?: string
) {
  const updateData: Record<string, string | null> = { feedback_status: status };
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { assignmentId } = await req.json();
    
    if (!assignmentId) {
      return new Response(
        JSON.stringify({ error: 'Assignment ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content': 'application/json' } }
      );
    }

    console.log(`Starting evaluation scoring for assignment ${assignmentId}`);

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Evaluation scoring timed out')), TIMEOUT_MS);
    });

    const mainPromise = (async () => {
      // Fetch assignment with room and student details
      const { data: assignment, error: assignmentError } = await supabaseClient
        .from('student_room_assignments')
        .select(`
          *,
          student:student_id (specialization_interest),
          room:room_id (*, specialty_id, specialty_ids)
        `)
        .eq('id', assignmentId)
        .single();

      if (assignmentError) throw assignmentError;

      if (!['completed', 'bedside'].includes(assignment.status)) {
        throw new Error('Cannot generate feedback for incomplete assignment');
      }

      // Fetch chat messages
      const { data: messages, error: messagesError } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true });

      if (messagesError) throw messagesError;

      // Fetch orders placed by student (via patient linked to room)
      let orders: Database['public']['Tables']['medical_orders']['Row'][] = [];
      if (assignment.room.patient_id) {
        const { data: ordersData } = await supabaseClient
          .from('medical_orders')
          .select('*')
          .eq('patient_id', assignment.room.patient_id)
          .is('deleted_at', null)
          .order('order_time', { ascending: true });
        orders = ordersData || [];
      }

      // Determine case difficulty
      const difficultyLevel = assignment.room.difficulty_level || 'intermediate';
      const caseDifficulty = difficultyLevel === 'beginner' ? 'easy' : 
                            difficultyLevel === 'advanced' ? 'advanced' : 'intermediate';

      // Count student messages (Clinical Action Units)
      const studentMessages = messages.filter(m => m.role === 'user' || m.role === 'student');
      
      // Prepare context for evaluation
      const conversation = messages.map(msg => 
        `${msg.role === 'user' || msg.role === 'student' ? 'STUDENT' : 'NURSE'}: ${msg.content}`
      ).join('\n\n');

      const ordersList = orders.length > 0 
        ? orders.map(o => `- ${o.order_name} (${o.category})${o.status ? ` [${o.status}]` : ''}`).join('\n')
        : 'No orders placed';

      // Build the evaluation prompt with the full rubric and exact feedback language.
      const evaluationPrompt = `${rubricReferenceText}

You are grading a physician on nurse Sophia, the simulation that covers overnight nurse pages and medical decision making.
Your goal is to grade the student fairly and return subsection scores plus feedback that stays as close as possible to the exact rubric language above.
When you write subsection feedback, keep it equivalent to the provided line for that score with no material deviation.

**SCORING RULES:**
- All scoring is based on the score that represents ≥50% of messages/orders, or the highest percentage
- No intermediate halfway scores - use only the defined score anchors
- If no meaningful messages or data, score should automatically be 0

**COMMUNICATION SCORE (0-5):**
Raw = Information Sharing (0-2) + Responsive Communication (0-3) + Efficiency Deduction (-2 to 0)
Final = clamp(raw, 0, 5)

**A) Information Sharing (0-2):**
- 0 criteria: ${COMMUNICATION_SCORING.informationSharing.scores[0].criteria}
- 1 criteria: ${COMMUNICATION_SCORING.informationSharing.scores[1].criteria}
- 2 criteria: ${COMMUNICATION_SCORING.informationSharing.scores[2].criteria}

**B) Responsive Communication (0-3):**
- 0 criteria: ${COMMUNICATION_SCORING.responsiveCommunication.scores[0].criteria}
- 1 criteria: ${COMMUNICATION_SCORING.responsiveCommunication.scores[1].criteria}
- 2 criteria: ${COMMUNICATION_SCORING.responsiveCommunication.scores[2].criteria}
- 3 criteria: ${COMMUNICATION_SCORING.responsiveCommunication.scores[3].criteria}

**C) Efficiency Deduction (-2 to 0):**
Count Clinical Action Units (CAUs) = messages with clinical questions, instructions, or orders
- Case difficulty: ${caseDifficulty}
- 0 criteria:
  easy: ${COMMUNICATION_SCORING.efficiencyDeduction.scores[0].easyCases}
  intermediate: ${COMMUNICATION_SCORING.efficiencyDeduction.scores[0].intermediateCases}
  advanced: ${COMMUNICATION_SCORING.efficiencyDeduction.scores[0].advancedCases}
- -1 criteria:
  easy: ${COMMUNICATION_SCORING.efficiencyDeduction.scores['-1'].easyCases}
  intermediate: ${COMMUNICATION_SCORING.efficiencyDeduction.scores['-1'].intermediateCases}
  advanced: ${COMMUNICATION_SCORING.efficiencyDeduction.scores['-1'].advancedCases}
- -2 criteria:
  easy: ${COMMUNICATION_SCORING.efficiencyDeduction.scores['-2'].easyCases}
  intermediate: ${COMMUNICATION_SCORING.efficiencyDeduction.scores['-2'].intermediateCases}
  advanced: ${COMMUNICATION_SCORING.efficiencyDeduction.scores['-2'].advancedCases}

**MDM SCORE (0-5):**
Raw = Labs/Orders Quality (0-3) + Note Thought Process (0-2) + Safety Deduction (-2 to 0)
Final = clamp(raw, 0, 5)

**D) Labs/Orders Quality (0-3):**
Using Must/Should/Could/Shouldn't/Mustn't framework:
- 0 criteria: ${MDM_SCORING.labsOrdersQuality.scores[0].criteria}
- 1 criteria: ${MDM_SCORING.labsOrdersQuality.scores[1].criteria}
- 2 criteria: ${MDM_SCORING.labsOrdersQuality.scores[2].criteria}
- 3 criteria: ${MDM_SCORING.labsOrdersQuality.scores[3].criteria}

**E) Progress Note Thought Process (0-2):**
Compare to reference note:
- 0 criteria: ${MDM_SCORING.noteThoughtProcess.scores[0].criteria}
- 1 criteria: ${MDM_SCORING.noteThoughtProcess.scores[1].criteria}
- 2 criteria: ${MDM_SCORING.noteThoughtProcess.scores[2].criteria}

**F) Safety Deduction (-2 to 0):**
- 0 criteria: ${MDM_SCORING.safetyDeduction.scores[0].criteria}
- -1 criteria: ${MDM_SCORING.safetyDeduction.scores['-1'].criteria}
- -2 criteria: ${MDM_SCORING.safetyDeduction.scores['-2'].criteria}

---

**CASE INFORMATION:**
Expected Diagnosis: ${JSON.stringify(assignment.room.expected_diagnosis)}
Expected Treatment: ${JSON.stringify(assignment.room.expected_treatment)}
Case Difficulty: ${caseDifficulty}

**STUDENT'S WORK:**
Use the student's progress note as the primary source for their assessment, working diagnosis, supporting evidence, and plan.
Do not penalize the student just because separate diagnosis or treatment-plan fields are blank.
If you need to infer their clinical reasoning, infer it from the progress note, conversation, and orders.
Progress Note: ${assignment.student_progress_note || 'Not provided'}
Legacy Diagnosis Field: ${assignment.diagnosis || 'Not provided'}
Legacy Treatment Plan Field: ${assignment.treatment_plan || 'Not provided'}

**CONVERSATION (${studentMessages.length} student messages):**
${conversation}

**ORDERS PLACED:**
${ordersList}

---

Provide your evaluation in this JSON format:
{
  "learning_objectives": "1-2 lines on what they missed and what they got right",
  "communication_score": <0-5>,
  "mdm_score": <0-5>,
  "communication_breakdown": {
    "information_sharing": {
      "score": <0-2>,
      "feedback": "<specific feedback from scoring rubric>"
    },
    "responsive_communication": {
      "score": <0-3>,
      "feedback": "<specific feedback from scoring rubric>"
    },
    "efficiency_deduction": {
      "score": <-2 to 0>,
      "feedback": "<specific feedback from scoring rubric>",
      "cau_count": <number>,
      "case_difficulty": "${caseDifficulty}"
    }
  },
  "mdm_breakdown": {
    "labs_orders_quality": {
      "score": <0-3>,
      "feedback": "<specific feedback from scoring rubric>"
    },
    "note_thought_process": {
      "score": <0-2>,
      "feedback": "<specific feedback from scoring rubric>"
    },
    "safety_deduction": {
      "score": <-2 to 0>,
      "feedback": "<specific feedback from scoring rubric>"
    }
  },
  "recommendations": ["<specific actionable recommendations>"]
}`;

      console.log('Generating evaluation with new Likert scoring...');

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `${EVALUATION_SYSTEM_PROMPT}\nYou must use the rubric language provided by the user prompt. Be precise with scoring, do not invent new score anchors, and keep each subsection feedback equivalent to the exact template line for the selected score.` },
          { role: "user", content: evaluationPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3, // Lower temperature for more consistent scoring
        max_tokens: 2500
      });

      const content = completion.choices[0].message.content;
      if (!content) throw new Error('No response from OpenAI');

      const evaluation = canonicalizeEvaluation(
        JSON.parse(content) as EvaluationScoringResponse,
        caseDifficulty,
      );

      console.log('Evaluation scores:', {
        communication: evaluation.communication_score,
        mdm: evaluation.mdm_score,
        infoSharing: evaluation.communication_breakdown?.information_sharing?.score,
        responsive: evaluation.communication_breakdown?.responsive_communication?.score,
        efficiency: evaluation.communication_breakdown?.efficiency_deduction?.score,
        labsOrders: evaluation.mdm_breakdown?.labs_orders_quality?.score,
        noteThought: evaluation.mdm_breakdown?.note_thought_process?.score,
        safety: evaluation.mdm_breakdown?.safety_deduction?.score
      });

      // Also generate legacy feedback for backward compatibility
      const legacyFeedback: LegacyFeedbackResponse = {
        summary: evaluation.learning_objectives,
        overall_score: Math.round((evaluation.communication_score + evaluation.mdm_score) / 2 * 10) / 10,
        clinical_reasoning: {
          score: evaluation.mdm_score,
          comments: `${evaluation.mdm_breakdown.labs_orders_quality.feedback} ${evaluation.mdm_breakdown.note_thought_process.feedback} ${evaluation.mdm_breakdown.safety_deduction.feedback}`.trim(),
          strengths: [
            evaluation.mdm_breakdown.labs_orders_quality.feedback,
            evaluation.mdm_breakdown.note_thought_process.feedback,
          ],
          areas_for_improvement: [evaluation.mdm_breakdown.safety_deduction.feedback]
        },
        communication_skills: {
          score: evaluation.communication_score,
          comments: `${evaluation.communication_breakdown.information_sharing.feedback} ${evaluation.communication_breakdown.responsive_communication.feedback} ${evaluation.communication_breakdown.efficiency_deduction.feedback}`.trim(),
          strengths: [
            evaluation.communication_breakdown.information_sharing.feedback,
            evaluation.communication_breakdown.responsive_communication.feedback,
          ],
          areas_for_improvement: [evaluation.communication_breakdown.efficiency_deduction.feedback]
        },
        recommendations: evaluation.recommendations
      };

      const derivedGrade = Math.max(
        0,
        Math.min(100, Math.round(legacyFeedback.overall_score * 20))
      );

      // Update assignment with both new scoring and legacy feedback
      const { error: updateError } = await supabaseClient
        .from('student_room_assignments')
        .update({
          // New scoring columns
          communication_score: evaluation.communication_score,
          mdm_score: evaluation.mdm_score,
          communication_breakdown: evaluation.communication_breakdown,
          mdm_breakdown: evaluation.mdm_breakdown,
          learning_objectives: evaluation.learning_objectives,
          case_difficulty: caseDifficulty,
          grade: derivedGrade,
          // Legacy feedback for backward compatibility
          nurse_feedback: legacyFeedback,
          feedback_status: 'completed',
          feedback_error: null,
          feedback_generated_at: new Date().toISOString()
        })
        .eq('id', assignmentId);

      if (updateError) throw updateError;

      console.log('Successfully saved evaluation scoring');
    })();

    await Promise.race([mainPromise, timeoutPromise]);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in evaluation scoring:', error);
    
    try {
      const { assignmentId } = await req.json().catch(() => ({}));
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
      console.error('Error updating status:', e);
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content': 'application/json' } }
    );
  }
});
