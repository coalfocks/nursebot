-- Add evaluation scoring system columns
-- Stores detailed Likert-scale scoring breakdown per Connor Yost's specification

-- Add columns to student_room_assignments for detailed scoring
ALTER TABLE public.student_room_assignments
  ADD COLUMN IF NOT EXISTS communication_score numeric(3,1),
  ADD COLUMN IF NOT EXISTS mdm_score numeric(3,1),
  ADD COLUMN IF NOT EXISTS communication_breakdown jsonb DEFAULT '{
    "information_sharing": {"score": 0, "feedback": ""},
    "responsive_communication": {"score": 0, "feedback": ""},
    "efficiency_deduction": {"score": 0, "feedback": "", "cau_count": 0, "case_difficulty": "intermediate"}
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS mdm_breakdown jsonb DEFAULT '{
    "labs_orders_quality": {"score": 0, "feedback": ""},
    "note_thought_process": {"score": 0, "feedback": ""},
    "safety_deduction": {"score": 0, "feedback": ""}
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS learning_objectives text,
  ADD COLUMN IF NOT EXISTS case_difficulty text CHECK (case_difficulty IN ('easy', 'intermediate', 'advanced'));

-- Add example progress note to rooms for reference during grading
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS example_progress_note text,
  ADD COLUMN IF NOT EXISTS order_categories jsonb DEFAULT '{
    "must_do": [],
    "should_do": [],
    "could_do": [],
    "shouldnt_do": [],
    "mustnt_do": []
  }'::jsonb;

-- Add index for faster queries on scoring
CREATE INDEX IF NOT EXISTS idx_assignments_communication_score 
  ON public.student_room_assignments(communication_score) 
  WHERE communication_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_mdm_score 
  ON public.student_room_assignments(mdm_score) 
  WHERE mdm_score IS NOT NULL;

COMMENT ON COLUMN public.student_room_assignments.communication_score IS 'Final Communication Score (0-5): Information Sharing (0-2) + Responsive Communication (0-3) + Efficiency Deduction (-2 to 0), clamped to 0-5';
COMMENT ON COLUMN public.student_room_assignments.mdm_score IS 'Final Medical Decision Making Score (0-5): Labs/Orders (0-3) + Note Thought Process (0-2) + Safety Deduction (-2 to 0), clamped to 0-5';
COMMENT ON COLUMN public.student_room_assignments.communication_breakdown IS 'Detailed breakdown of communication scoring with sub-scores and feedback';
COMMENT ON COLUMN public.student_room_assignments.mdm_breakdown IS 'Detailed breakdown of MDM scoring with sub-scores and feedback';
COMMENT ON COLUMN public.student_room_assignments.learning_objectives IS 'Summary of learning objectives from the evaluation';
COMMENT ON COLUMN public.rooms.example_progress_note IS 'Reference physician progress note for this case used in grading';
COMMENT ON COLUMN public.rooms.order_categories IS 'Categorized orders for Must/Should/Could/Shouldnt/Mustnt framework';
