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
        }
        Insert: {
          id?: string
          assignment_id: string
          role: 'student' | 'assistant'
          content: string
          created_at?: string
          tokens_used?: number | null
          triggered_completion?: boolean
        }
        Update: {
          id?: string
          assignment_id?: string
          role?: 'student' | 'assistant'
          content?: string
          created_at?: string
          tokens_used?: number | null
          triggered_completion?: boolean
        }
      }
      specialties: {
        Row: {
          id: string
          name: string
          description: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          created_at?: string
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
          specialty_id: string | null
          difficulty_level: 'beginner' | 'intermediate' | 'advanced' | null
          expected_diagnosis: string | null
          expected_treatment: string[] | null
          initial_vitals: Json | null
          created_by: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          pdf_url: string | null
        }
        Insert: {
          id?: number
          room_number: string
          role: string
          objective: string
          context: string
          style: string
          specialty_id?: string | null
          difficulty_level?: 'beginner' | 'intermediate' | 'advanced' | null
          expected_diagnosis?: string | null
          expected_treatment?: string[] | null
          initial_vitals?: Json | null
          created_by?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          pdf_url?: string | null
        }
        Update: {
          id?: number
          room_number?: string
          role?: string
          objective?: string
          context?: string
          style?: string
          specialty_id?: string | null
          difficulty_level?: 'beginner' | 'intermediate' | 'advanced' | null
          expected_diagnosis?: string | null
          expected_treatment?: string[] | null
          initial_vitals?: Json | null
          created_by?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          pdf_url?: string | null
        }
      }
      student_room_assignments: {
        Row: {
          id: string
          student_id: string
          room_id: number
          assigned_by: string
          status: 'assigned' | 'in_progress' | 'completed'
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
            overallScore: number
            clinicalReasoning: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            communication: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            professionalism: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            summary: string
            recommendations: string[]
          } | null
          feedback_generated_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          student_id: string
          room_id: number
          assigned_by: string
          status?: 'assigned' | 'in_progress' | 'completed'
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
            overallScore: number
            clinicalReasoning: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            communication: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            professionalism: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            summary: string
            recommendations: string[]
          } | null
          feedback_generated_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          student_id?: string
          room_id?: number
          assigned_by?: string
          status?: 'assigned' | 'in_progress' | 'completed'
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
            overallScore: number
            clinicalReasoning: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            communication: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            professionalism: {
              score: number
              comments: string
              strengths: string[]
              areasForImprovement: string[]
            }
            summary: string
            recommendations: string[]
          } | null
          feedback_generated_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Enums: {
      message_role: 'student' | 'assistant'
      feedback_status: 'pending' | 'processing' | 'completed' | 'failed'
    }
  }
}