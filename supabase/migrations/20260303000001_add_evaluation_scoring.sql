-- Add evaluation scoring columns to student_room_assignments
-- This migration adds the new Likert-scale evaluation system from Connor Yost

ALTER TABLE public.student_room_assignments
ADD COLUMN IF NOT EXISTS communication_score DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS mdm_score DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS communication_breakdown JSONB,
ADD COLUMN IF NOT EXISTS mdm_breakdown JSONB,
ADD COLUMN IF NOT EXISTS learning_objectives TEXT,
ADD COLUMN IF NOT EXISTS case_difficulty VARCHAR(50) DEFAULT 'intermediate';

-- Add comments for documentation
COMMENT ON COLUMN public.student_room_assignments.communication_score IS 'Final communication score (0-5) calculated from Information Sharing + Responsive Communication + Efficiency Deduction';
COMMENT ON COLUMN public.student_room_assignments.mdm_score IS 'Final medical decision making score (0-5) calculated from Labs/Orders + Note Thought Process + Safety Deduction';
COMMENT ON COLUMN public.student_room_assignments.communication_breakdown IS 'JSON object containing detailed breakdown: {information_sharing: {score, feedback}, responsive_communication: {score, feedback}, efficiency_deduction: {score, feedback, cau_count, case_difficulty}}';
COMMENT ON COLUMN public.student_room_assignments.mdm_breakdown IS 'JSON object containing detailed breakdown: {labs_orders_quality: {score, feedback}, note_thought_process: {score, feedback}, safety_deduction: {score, feedback}}';
COMMENT ON COLUMN public.student_room_assignments.learning_objectives IS '1-2 lines summarizing what the student missed and what they got right';
COMMENT ON COLUMN public.student_room_assignments.case_difficulty IS 'Case difficulty level: easy, intermediate, or advanced';

-- Create index for faster queries on feedback status
CREATE INDEX IF NOT EXISTS idx_student_room_assignments_feedback_status 
ON public.student_room_assignments(feedback_status) 
WHERE feedback_status IN ('pending', 'processing', 'completed', 'failed');

-- Create index for evaluation scores
CREATE INDEX IF NOT EXISTS idx_student_room_assignments_scores 
ON public.student_room_assignments(communication_score, mdm_score) 
WHERE feedback_status = 'completed';
