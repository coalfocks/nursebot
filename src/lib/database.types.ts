export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string
          study_year: number
          specialization_interest: string | null
          phone_number: string | null
          sms_consent: boolean
          is_admin: boolean
          email: string
          role: 'student' | 'school_admin' | 'super_admin' | 'test_user'
          school_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          study_year: number
          specialization_interest?: string | null
          phone_number?: string | null
          sms_consent?: boolean
          is_admin?: boolean
          email?: string
          role?: 'student' | 'school_admin' | 'super_admin' | 'test_user'
          school_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          study_year?: number
          specialization_interest?: string | null
          phone_number?: string | null
          sms_consent?: boolean
          is_admin?: boolean
          email?: string
          role?: 'student' | 'school_admin' | 'super_admin' | 'test_user'
          school_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      chat_messages: {
        Row: {
          id: string
          assignment_id: string
          role: 'student' | 'assistant'
          content: string
          created_at: string
          tokens_used: number | null
          triggered_completion: boolean
          school_id: string
        }
        Insert: {
          id?: string
          assignment_id: string
          role: 'student' | 'assistant'
          content: string
          created_at?: string
          tokens_used?: number | null
          triggered_completion?: boolean
          school_id?: string
        }
        Update: {
          id?: string
          assignment_id?: string
          role?: 'student' | 'assistant'
          content?: string
          created_at?: string
          tokens_used?: number | null
          triggered_completion?: boolean
          school_id?: string
        }
      }
      case_blueprints: {
        Row: {
          id: string
          title: string
          specialty: string
          difficulty: 'easy' | 'intermediate' | 'difficult'
          objectives: string
          admitting_hpi: string
          hospital_days: number | null
          admit_orders: string | null
          admission_vitals: string | null
          admission_labs: string | null
          admission_exam: string | null
          initial_message: string | null
          bedside_required: boolean
          event_vitals: string | null
          nurse_exam: string | null
          bedside_exam: string | null
          typical_questions: string[] | null
          imaging_and_orders: string | null
          harmful_actions: string[] | null
          progress_note: string | null
          created_by: string | null
          school_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          specialty: string
          difficulty: 'easy' | 'intermediate' | 'difficult'
          objectives: string
          admitting_hpi: string
          hospital_days?: number | null
          admit_orders?: string | null
          admission_vitals?: string | null
          admission_labs?: string | null
          admission_exam?: string | null
          initial_message?: string | null
          bedside_required?: boolean
          event_vitals?: string | null
          nurse_exam?: string | null
          bedside_exam?: string | null
          typical_questions?: string[] | null
          imaging_and_orders?: string | null
          harmful_actions?: string[] | null
          progress_note?: string | null
          created_by?: string | null
          school_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          specialty?: string
          difficulty?: 'easy' | 'intermediate' | 'difficult'
          objectives?: string
          admitting_hpi?: string
          hospital_days?: number | null
          admit_orders?: string | null
          admission_vitals?: string | null
          admission_labs?: string | null
          admission_exam?: string | null
          initial_message?: string | null
          bedside_required?: boolean
          event_vitals?: string | null
          nurse_exam?: string | null
          bedside_exam?: string | null
          typical_questions?: string[] | null
          imaging_and_orders?: string | null
          harmful_actions?: string[] | null
          progress_note?: string | null
          created_by?: string | null
          school_id?: string
          created_at?: string
          updated_at?: string
        }
      }
      specialties: {
        Row: {
          id: string
          name: string
          description: string
          created_at: string
          school_id: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          created_at?: string
          school_id?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          created_at?: string
          school_id?: string
        }
      }
      rooms: {
        Row: {
          id: number
          room_number: string
          role: string
          objective: string
          context: string
          style: string
          nurse_context: string | null
          emr_context: string | null
          specialty_id: string | null
          difficulty_level: 'beginner' | 'intermediate' | 'advanced' | null
          expected_diagnosis: string | null
          expected_treatment: string[] | null
          initial_vitals: Json | null
          case_goals: string | null
          progress_note: string | null
          completion_hint: string | null
          bedside_hint: string | null
          created_by: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          pdf_url: string | null
          school_id: string
          orders_config: Json | null
          patient_id: string | null
          continues_from: number | null
        }
        Insert: {
          id?: number
          room_number: string
          role: string
          objective: string
          context: string
          style: string
          nurse_context?: string | null
          emr_context?: string | null
          specialty_id?: string | null
          difficulty_level?: 'beginner' | 'intermediate' | 'advanced' | null
          expected_diagnosis?: string | null
          expected_treatment?: string[] | null
          initial_vitals?: Json | null
          case_goals?: string | null
          progress_note?: string | null
          completion_hint?: string | null
          bedside_hint?: string | null
          created_by?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          pdf_url?: string | null
          school_id?: string
          orders_config?: Json | null
          patient_id?: string | null
          continues_from?: number | null
        }
        Update: {
          id?: number
          room_number?: string
          role?: string
          objective?: string
          context?: string
          style?: string
          nurse_context?: string | null
          emr_context?: string | null
          specialty_id?: string | null
          difficulty_level?: 'beginner' | 'intermediate' | 'advanced' | null
          expected_diagnosis?: string | null
          expected_treatment?: string[] | null
          initial_vitals?: Json | null
          case_goals?: string | null
          progress_note?: string | null
          completion_hint?: string | null
          bedside_hint?: string | null
          created_by?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          pdf_url?: string | null
          school_id?: string
          orders_config?: Json | null
          patient_id?: string | null
          continues_from?: number | null
        }
      }
      student_room_assignments: {
        Row: {
          id: string
          student_id: string
          room_id: number
          assigned_by: string
          status: 'assigned' | 'in_progress' | 'bedside' | 'completed'
          due_date: string | null
          effective_date: string | null
          notification_sent: boolean | null
          notification_sent_at: string | null
          feedback: string | null
          grade: number | null
          diagnosis: string | null
          treatment_plan: string[] | null
          completion_token_matched: boolean
          feedback_status: 'pending' | 'processing' | 'completed' | 'failed'
          feedback_error: string | null
          nurse_feedback: {
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
          } | null;
          feedback_generated_at: string | null
          created_at: string
          updated_at: string
          school_id: string
        }
        Insert: {
          id?: string
          student_id: string
          room_id: number
          assigned_by: string
          status?: 'assigned' | 'in_progress' | 'bedside' | 'completed'
          due_date?: string | null
          effective_date?: string | null
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          feedback?: string | null
          grade?: number | null
          diagnosis?: string | null
          treatment_plan?: string[] | null
          completion_token_matched?: boolean
          feedback_status?: 'pending' | 'processing' | 'completed' | 'failed'
          feedback_error?: string | null
          nurse_feedback?: {
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
          } | null;
          feedback_generated_at?: string | null
          created_at?: string
          updated_at?: string
          school_id?: string
        }
        Update: {
          id?: string
          student_id?: string
          room_id?: number
          assigned_by?: string
          status?: 'assigned' | 'in_progress' | 'bedside' | 'completed'
          due_date?: string | null
          effective_date?: string | null
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          feedback?: string | null
          grade?: number | null
          diagnosis?: string | null
          treatment_plan?: string[] | null
          completion_token_matched?: boolean
          feedback_status?: 'pending' | 'processing' | 'completed' | 'failed'
          feedback_error?: string | null
          nurse_feedback?: {
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
          } | null;
          feedback_generated_at?: string | null
          created_at?: string
          updated_at?: string
          school_id?: string
        }
      }
      schools: {
        Row: {
          id: string
          name: string
          slug: string
          timezone: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          timezone?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          timezone?: string | null
          created_at?: string
        }
      }
    }
      patients: {
        Row: {
          id: string
          school_id: string | null
          room_id: number | null
          mrn: string
          first_name: string
          last_name: string
          date_of_birth: string
          gender: string
          service: string | null
          admission_date: string | null
          attending_physician: string | null
          allergies: string[] | null
          code_status: string | null
          intake_output: Json | null
          created_at: string
          updated_at: string
          deleted_at: string | null
          custom_overview_sections: Json | null
        }
        Insert: {
          id?: string
          school_id?: string | null
          room_id?: number | null
          mrn: string
          first_name: string
          last_name: string
          date_of_birth: string
          gender: string
          service?: string | null
          admission_date?: string | null
          attending_physician?: string | null
          allergies?: string[] | null
          code_status?: string | null
          intake_output?: Json | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          custom_overview_sections?: Json | null
        }
        Update: {
          id?: string
          school_id?: string | null
          room_id?: number | null
          mrn?: string
          first_name?: string
          last_name?: string
          date_of_birth?: string
          gender?: string
          service?: string | null
          admission_date?: string | null
          attending_physician?: string | null
          allergies?: string[] | null
          code_status?: string | null
          intake_output?: Json | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          custom_overview_sections?: Json | null
        }
      }
      clinical_notes: {
        Row: {
          id: string
          patient_id: string | null
          assignment_id: string | null
          room_id: number | null
          override_scope: 'baseline' | 'room' | 'assignment'
          school_id: string | null
          note_type: string
          title: string
          content: string
          author: string | null
          timestamp: string
          signed: boolean
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          note_type: string
          title: string
          content: string
          author?: string | null
          timestamp?: string
          signed?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          note_type?: string
          title?: string
          content?: string
          author?: string | null
          timestamp?: string
          signed?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      lab_results: {
        Row: {
          id: string
          patient_id: string | null
          assignment_id: string | null
          room_id: number | null
          override_scope: 'baseline' | 'room' | 'assignment'
          school_id: string | null
          test_name: string
          value: number | null
          unit: string | null
          reference_range: string | null
          status: string | null
          collection_time: string | null
          result_time: string | null
          ordered_by: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          test_name: string
          value?: number | null
          unit?: string | null
          reference_range?: string | null
          status?: string | null
          collection_time?: string | null
          result_time?: string | null
          ordered_by?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          test_name?: string
          value?: number | null
          unit?: string | null
          reference_range?: string | null
          status?: string | null
          collection_time?: string | null
          result_time?: string | null
          ordered_by?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      vital_signs: {
        Row: {
          id: string
          patient_id: string | null
          assignment_id: string | null
          room_id: number | null
          override_scope: 'baseline' | 'room' | 'assignment'
          school_id: string | null
          timestamp: string
          temperature: number | null
          blood_pressure_systolic: number | null
          blood_pressure_diastolic: number | null
          heart_rate: number | null
          respiratory_rate: number | null
          oxygen_saturation: number | null
          pain: number | null
          weight: number | null
          height: number | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          timestamp: string
          temperature?: number | null
          blood_pressure_systolic?: number | null
          blood_pressure_diastolic?: number | null
          heart_rate?: number | null
          respiratory_rate?: number | null
          oxygen_saturation?: number | null
          pain?: number | null
          weight?: number | null
          height?: number | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          timestamp?: string
          temperature?: number | null
          blood_pressure_systolic?: number | null
          blood_pressure_diastolic?: number | null
          heart_rate?: number | null
          respiratory_rate?: number | null
          oxygen_saturation?: number | null
          pain?: number | null
          weight?: number | null
          height?: number | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      medical_orders: {
        Row: {
          id: string
          patient_id: string | null
          assignment_id: string | null
          room_id: number | null
          override_scope: 'baseline' | 'room' | 'assignment'
          school_id: string | null
          category: string
          order_name: string
          frequency: string | null
          route: string | null
          dose: string | null
          priority: string | null
          status: string | null
          ordered_by: string | null
          order_time: string
          scheduled_time: string | null
          instructions: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          category: string
          order_name: string
          frequency?: string | null
          route?: string | null
          dose?: string | null
          priority?: string | null
          status?: string | null
          ordered_by?: string | null
          order_time?: string
          scheduled_time?: string | null
          instructions?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          category?: string
          order_name?: string
          frequency?: string | null
          route?: string | null
          dose?: string | null
          priority?: string | null
          status?: string | null
          ordered_by?: string | null
          order_time?: string
          scheduled_time?: string | null
          instructions?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      imaging_studies: {
        Row: {
          id: string
          patient_id: string | null
          assignment_id: string | null
          room_id: number | null
          override_scope: 'baseline' | 'room' | 'assignment'
          school_id: string | null
          order_name: string | null
          study_type: string
          contrast: string | null
          priority: string | null
          status: string | null
          ordered_by: string | null
          order_time: string
          report: string | null
          report_generated_at: string | null
          images: Json | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          order_name?: string | null
          study_type: string
          contrast?: string | null
          priority?: string | null
          status?: string | null
          ordered_by?: string | null
          order_time?: string
          report?: string | null
          report_generated_at?: string | null
          images?: Json | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          patient_id?: string | null
          assignment_id?: string | null
          room_id?: number | null
          override_scope?: 'baseline' | 'room' | 'assignment'
          school_id?: string | null
          order_name?: string | null
          study_type?: string
          contrast?: string | null
          priority?: string | null
          status?: string | null
          ordered_by?: string | null
          order_time?: string
          report?: string | null
          report_generated_at?: string | null
          images?: Json | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
    Enums: {
      message_role: 'student' | 'assistant'
      feedback_status: 'pending' | 'processing' | 'completed' | 'failed'
    }
  }
}
