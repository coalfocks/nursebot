export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      case_blueprints: {
        Row: {
          admission_exam: string | null
          admission_labs: string | null
          admission_vitals: string | null
          admit_orders: string | null
          admitting_hpi: string
          bedside_exam: string | null
          bedside_required: boolean | null
          created_at: string
          created_by: string | null
          difficulty: string
          event_vitals: string | null
          harmful_actions: string[] | null
          hospital_days: number | null
          id: string
          imaging_and_orders: string | null
          initial_message: string | null
          nurse_exam: string | null
          objectives: string
          progress_note: string | null
          school_id: string
          specialty: string
          title: string
          typical_questions: string[] | null
          updated_at: string
        }
        Insert: {
          admission_exam?: string | null
          admission_labs?: string | null
          admission_vitals?: string | null
          admit_orders?: string | null
          admitting_hpi: string
          bedside_exam?: string | null
          bedside_required?: boolean | null
          created_at?: string
          created_by?: string | null
          difficulty: string
          event_vitals?: string | null
          harmful_actions?: string[] | null
          hospital_days?: number | null
          id?: string
          imaging_and_orders?: string | null
          initial_message?: string | null
          nurse_exam?: string | null
          objectives: string
          progress_note?: string | null
          school_id: string
          specialty: string
          title: string
          typical_questions?: string[] | null
          updated_at?: string
        }
        Update: {
          admission_exam?: string | null
          admission_labs?: string | null
          admission_vitals?: string | null
          admit_orders?: string | null
          admitting_hpi?: string
          bedside_exam?: string | null
          bedside_required?: boolean | null
          created_at?: string
          created_by?: string | null
          difficulty?: string
          event_vitals?: string | null
          harmful_actions?: string[] | null
          hospital_days?: number | null
          id?: string
          imaging_and_orders?: string | null
          initial_message?: string | null
          nurse_exam?: string | null
          objectives?: string
          progress_note?: string | null
          school_id?: string
          specialty?: string
          title?: string
          typical_questions?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_blueprints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_blueprints_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          assignment_id: string
          content: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["message_role"]
          school_id: string
          tokens_used: number | null
          triggered_completion: boolean | null
        }
        Insert: {
          assignment_id: string
          content: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["message_role"]
          school_id?: string
          tokens_used?: number | null
          triggered_completion?: boolean | null
        }
        Update: {
          assignment_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["message_role"]
          school_id?: string
          tokens_used?: number | null
          triggered_completion?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "student_room_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_notes: {
        Row: {
          assignment_id: string | null
          author: string | null
          content: string
          created_at: string | null
          deleted_at: string | null
          id: string
          note_type: string
          override_scope: string
          patient_id: string | null
          room_id: number | null
          school_id: string | null
          signed: boolean | null
          timestamp: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          assignment_id?: string | null
          author?: string | null
          content: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          note_type: string
          override_scope?: string
          patient_id?: string | null
          room_id?: number | null
          school_id?: string | null
          signed?: boolean | null
          timestamp?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          assignment_id?: string | null
          author?: string | null
          content?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          note_type?: string
          override_scope?: string
          patient_id?: string | null
          room_id?: number | null
          school_id?: string | null
          signed?: boolean | null
          timestamp?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      imaging_studies: {
        Row: {
          assignment_id: string | null
          contrast: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          images: Json | null
          order_name: string | null
          order_time: string | null
          ordered_by: string | null
          override_scope: string
          patient_id: string | null
          priority: string | null
          report: string | null
          report_generated_at: string | null
          room_id: number | null
          school_id: string | null
          status: string | null
          study_type: string
          updated_at: string | null
        }
        Insert: {
          assignment_id?: string | null
          contrast?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          images?: Json | null
          order_name?: string | null
          order_time?: string | null
          ordered_by?: string | null
          override_scope?: string
          patient_id?: string | null
          priority?: string | null
          report?: string | null
          report_generated_at?: string | null
          room_id?: number | null
          school_id?: string | null
          status?: string | null
          study_type: string
          updated_at?: string | null
        }
        Update: {
          assignment_id?: string | null
          contrast?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          images?: Json | null
          order_name?: string | null
          order_time?: string | null
          ordered_by?: string | null
          override_scope?: string
          patient_id?: string | null
          priority?: string | null
          report?: string | null
          report_generated_at?: string | null
          room_id?: number | null
          school_id?: string | null
          status?: string | null
          study_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "imaging_studies_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "student_room_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imaging_studies_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imaging_studies_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imaging_studies_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_results: {
        Row: {
          assignment_id: string | null
          collection_time: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          ordered_by: string | null
          override_scope: string
          patient_id: string | null
          reference_range: string | null
          result_time: string | null
          room_id: number | null
          school_id: string | null
          status: string | null
          test_name: string
          unit: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          assignment_id?: string | null
          collection_time?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          ordered_by?: string | null
          override_scope?: string
          patient_id?: string | null
          reference_range?: string | null
          result_time?: string | null
          room_id?: number | null
          school_id?: string | null
          status?: string | null
          test_name: string
          unit?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          assignment_id?: string | null
          collection_time?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          ordered_by?: string | null
          override_scope?: string
          patient_id?: string | null
          reference_range?: string | null
          result_time?: string | null
          room_id?: number | null
          school_id?: string | null
          status?: string | null
          test_name?: string
          unit?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_results_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "student_room_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_results_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_results_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_results_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_orders: {
        Row: {
          assignment_id: string | null
          category: string
          created_at: string | null
          deleted_at: string | null
          dose: string | null
          frequency: string | null
          id: string
          instructions: string | null
          order_name: string
          order_time: string | null
          ordered_by: string | null
          override_scope: string
          patient_id: string | null
          priority: string | null
          room_id: number | null
          route: string | null
          scheduled_time: string | null
          school_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          assignment_id?: string | null
          category: string
          created_at?: string | null
          deleted_at?: string | null
          dose?: string | null
          frequency?: string | null
          id?: string
          instructions?: string | null
          order_name: string
          order_time?: string | null
          ordered_by?: string | null
          override_scope?: string
          patient_id?: string | null
          priority?: string | null
          room_id?: number | null
          route?: string | null
          scheduled_time?: string | null
          school_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          assignment_id?: string | null
          category?: string
          created_at?: string | null
          deleted_at?: string | null
          dose?: string | null
          frequency?: string | null
          id?: string
          instructions?: string | null
          order_name?: string
          order_time?: string | null
          ordered_by?: string | null
          override_scope?: string
          patient_id?: string | null
          priority?: string | null
          room_id?: number | null
          route?: string | null
          scheduled_time?: string | null
          school_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medical_orders_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "student_room_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_orders_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_orders_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          admission_date: string | null
          allergies: string[] | null
          attending_physician: string | null
          code_status: string | null
          created_at: string | null
          custom_overview_sections: Json | null
          date_of_birth: string
          deleted_at: string | null
          first_name: string
          gender: string
          id: string
          intake_output: Json | null
          last_name: string
          mrn: string
          room_id: number | null
          school_id: string | null
          service: string | null
          updated_at: string | null
        }
        Insert: {
          admission_date?: string | null
          allergies?: string[] | null
          attending_physician?: string | null
          code_status?: string | null
          created_at?: string | null
          custom_overview_sections?: Json | null
          date_of_birth: string
          deleted_at?: string | null
          first_name: string
          gender: string
          id?: string
          intake_output?: Json | null
          last_name: string
          mrn: string
          room_id?: number | null
          school_id?: string | null
          service?: string | null
          updated_at?: string | null
        }
        Update: {
          admission_date?: string | null
          allergies?: string[] | null
          attending_physician?: string | null
          code_status?: string | null
          created_at?: string | null
          custom_overview_sections?: Json | null
          date_of_birth?: string
          deleted_at?: string | null
          first_name?: string
          gender?: string
          id?: string
          intake_output?: Json | null
          last_name?: string
          mrn?: string
          room_id?: number | null
          school_id?: string | null
          service?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          full_name: string
          id: string
          is_admin: boolean | null
          phone_number: string | null
          role: string
          school_id: string | null
          sms_consent: boolean | null
          specialization_interest: string | null
          study_year: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name: string
          id: string
          is_admin?: boolean | null
          phone_number?: string | null
          role?: string
          school_id?: string | null
          sms_consent?: boolean | null
          specialization_interest?: string | null
          study_year: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_admin?: boolean | null
          phone_number?: string | null
          role?: string
          school_id?: string | null
          sms_consent?: boolean | null
          specialization_interest?: string | null
          study_year?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_tracking: {
        Row: {
          average_score: number | null
          cases_completed: number | null
          id: string
          last_activity_at: string | null
          specialty_id: string | null
          student_id: string | null
          total_time_spent: unknown
        }
        Insert: {
          average_score?: number | null
          cases_completed?: number | null
          id?: string
          last_activity_at?: string | null
          specialty_id?: string | null
          student_id?: string | null
          total_time_spent?: unknown
        }
        Update: {
          average_score?: number | null
          cases_completed?: number | null
          id?: string
          last_activity_at?: string | null
          specialty_id?: string | null
          student_id?: string | null
          total_time_spent?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "progress_tracking_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_tracking_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          available_school_ids: string[] | null
          bedside_hint: string | null
          case_goals: string | null
          completion_hint: string | null
          completion_token: string
          context: string | null
          continues_from: number | null
          created_at: string
          created_by: string | null
          delivery_note: string | null
          difficulty_level: string | null
          emr_context: string | null
          expected_diagnosis: string | null
          expected_treatment: string[] | null
          id: number
          is_active: boolean | null
          nurse_context: string | null
          objective: string | null
          orders_config: Json | null
          patient_id: string | null
          pdf_url: string | null
          progress_note: string | null
          role: string | null
          room_number: string
          school_id: string
          specialty_id: string | null
          specialty_ids: string[] | null
          style: string | null
          updated_at: string | null
        }
        Insert: {
          available_school_ids?: string[] | null
          bedside_hint?: string | null
          case_goals?: string | null
          completion_hint?: string | null
          completion_token?: string
          context?: string | null
          continues_from?: number | null
          created_at?: string
          created_by?: string | null
          delivery_note?: string | null
          difficulty_level?: string | null
          emr_context?: string | null
          expected_diagnosis?: string | null
          expected_treatment?: string[] | null
          id?: number
          is_active?: boolean | null
          nurse_context?: string | null
          objective?: string | null
          orders_config?: Json | null
          patient_id?: string | null
          pdf_url?: string | null
          progress_note?: string | null
          role?: string | null
          room_number: string
          school_id?: string
          specialty_id?: string | null
          specialty_ids?: string[] | null
          style?: string | null
          updated_at?: string | null
        }
        Update: {
          available_school_ids?: string[] | null
          bedside_hint?: string | null
          case_goals?: string | null
          completion_hint?: string | null
          completion_token?: string
          context?: string | null
          continues_from?: number | null
          created_at?: string
          created_by?: string | null
          delivery_note?: string | null
          difficulty_level?: string | null
          emr_context?: string | null
          expected_diagnosis?: string | null
          expected_treatment?: string[] | null
          id?: number
          is_active?: boolean | null
          nurse_context?: string | null
          objective?: string | null
          orders_config?: Json | null
          patient_id?: string | null
          pdf_url?: string | null
          progress_note?: string | null
          role?: string | null
          room_number?: string
          school_id?: string
          specialty_id?: string | null
          specialty_ids?: string[] | null
          style?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_continues_from_fkey"
            columns: ["continues_from"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_specialty_id_fkey"
            columns: ["specialty_id"]
            isOneToOne: false
            referencedRelation: "specialties"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          timezone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          timezone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string | null
        }
        Relationships: []
      }
      specialties: {
        Row: {
          created_at: string | null
          description: string
          id: string
          name: string
          school_id: string
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          name: string
          school_id?: string
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          name?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "specialties_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      student_room_assignments: {
        Row: {
          assigned_by: string
          completed_at: string | null
          completion_token_matched: boolean | null
          created_at: string | null
          diagnosis: string | null
          effective_date: string | null
          feedback: string | null
          feedback_error: string | null
          feedback_generated_at: string | null
          feedback_status: Database["public"]["Enums"]["feedback_status"] | null
          grade: number | null
          id: string
          notification_sent: boolean | null
          notification_sent_at: string | null
          nurse_feedback: Json | null
          room_id: number
          school_id: string
          status: string | null
          student_id: string
          treatment_plan: string[] | null
          updated_at: string | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          assigned_by: string
          completed_at?: string | null
          completion_token_matched?: boolean | null
          created_at?: string | null
          diagnosis?: string | null
          effective_date?: string | null
          feedback?: string | null
          feedback_error?: string | null
          feedback_generated_at?: string | null
          feedback_status?:
            | Database["public"]["Enums"]["feedback_status"]
            | null
          grade?: number | null
          id?: string
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          nurse_feedback?: Json | null
          room_id: number
          school_id?: string
          status?: string | null
          student_id: string
          treatment_plan?: string[] | null
          updated_at?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          assigned_by?: string
          completed_at?: string | null
          completion_token_matched?: boolean | null
          created_at?: string | null
          diagnosis?: string | null
          effective_date?: string | null
          feedback?: string | null
          feedback_error?: string | null
          feedback_generated_at?: string | null
          feedback_status?:
            | Database["public"]["Enums"]["feedback_status"]
            | null
          grade?: number | null
          id?: string
          notification_sent?: boolean | null
          notification_sent_at?: string | null
          nurse_feedback?: Json | null
          room_id?: number
          school_id?: string
          status?: string | null
          student_id?: string
          treatment_plan?: string[] | null
          updated_at?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_room_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_room_assignments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_room_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_room_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vital_signs: {
        Row: {
          assignment_id: string | null
          blood_pressure_diastolic: number | null
          blood_pressure_systolic: number | null
          created_at: string | null
          deleted_at: string | null
          heart_rate: number | null
          height: number | null
          id: string
          override_scope: string
          oxygen_saturation: number | null
          pain: number | null
          patient_id: string | null
          respiratory_rate: number | null
          room_id: number | null
          school_id: string | null
          temperature: number | null
          timestamp: string
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          assignment_id?: string | null
          blood_pressure_diastolic?: number | null
          blood_pressure_systolic?: number | null
          created_at?: string | null
          deleted_at?: string | null
          heart_rate?: number | null
          height?: number | null
          id?: string
          override_scope?: string
          oxygen_saturation?: number | null
          pain?: number | null
          patient_id?: string | null
          respiratory_rate?: number | null
          room_id?: number | null
          school_id?: string | null
          temperature?: number | null
          timestamp: string
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          assignment_id?: string | null
          blood_pressure_diastolic?: number | null
          blood_pressure_systolic?: number | null
          created_at?: string | null
          deleted_at?: string | null
          heart_rate?: number | null
          height?: number | null
          id?: string
          override_scope?: string
          oxygen_saturation?: number | null
          pain?: number | null
          patient_id?: string | null
          respiratory_rate?: number | null
          room_id?: number | null
          school_id?: string | null
          temperature?: number | null
          timestamp?: string
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_signs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_complete_assignments: { Args: never; Returns: undefined }
    }
    Enums: {
      feedback_status: "pending" | "processing" | "completed" | "failed"
      message_role: "student" | "assistant"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      feedback_status: ["pending", "processing", "completed", "failed"],
      message_role: ["student", "assistant"],
    },
  },
} as const
