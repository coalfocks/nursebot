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
          is_admin: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          study_year: number
          specialization_interest?: string | null
          is_admin?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          study_year?: number
          specialization_interest?: string | null
          is_admin?: boolean
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
      cases: {
        Row: {
          id: string
          specialty_id: string
          title: string
          description: string
          patient_history: string
          initial_vitals: Json
          difficulty_level: string
          expected_diagnosis: string
          expected_treatment: string[]
          created_by: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          specialty_id: string
          title: string
          description: string
          patient_history: string
          initial_vitals: Json
          difficulty_level: string
          expected_diagnosis: string
          expected_treatment: string[]
          created_by: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          specialty_id?: string
          title?: string
          description?: string
          patient_history?: string
          initial_vitals?: Json
          difficulty_level?: string
          expected_diagnosis?: string
          expected_treatment?: string[]
          created_by?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}