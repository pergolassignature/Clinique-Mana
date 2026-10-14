export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      account_deletion_guards: {
        Row: {
          created_at: string
          guard_function: string
          module_key: string
        }
        Insert: {
          created_at?: string
          guard_function: string
          module_key: string
        }
        Update: {
          created_at?: string
          guard_function?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_guards_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: true
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      ai_requests: {
        Row: {
          completion_tokens: number
          cost_cents: number
          created_at: string
          error_code: string | null
          id: string
          kind: string
          model: string
          org_id: string
          prompt_tokens: number
          status: string
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number
          cost_cents?: number
          created_at?: string
          error_code?: string | null
          id?: string
          kind: string
          model: string
          org_id: string
          prompt_tokens?: number
          status: string
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number
          cost_cents?: number
          created_at?: string
          error_code?: string | null
          id?: string
          kind?: string
          model?: string
          org_id?: string
          prompt_tokens?: number
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          enabled: boolean
          input_cents_per_mtok: number
          model: string
          monthly_cap_cents: number
          org_id: string
          output_cents_per_mtok: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          input_cents_per_mtok?: number
          model?: string
          monthly_cap_cents?: number
          org_id: string
          output_cents_per_mtok?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          input_cents_per_mtok?: number
          model?: string
          monthly_cap_cents?: number
          org_id?: string
          output_cents_per_mtok?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      appointment_messages: {
        Row: {
          appointment_id: string
          attempts: number
          channel: string
          client_id: string
          created_at: string
          event_at: string | null
          id: string
          kind: string
          language: string
          link_id: string | null
          org_id: string
          recipient_client_id: string
          sent_at: string | null
          skip_reason: string | null
          sms_message_id: string | null
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          attempts?: number
          channel: string
          client_id: string
          created_at?: string
          event_at?: string | null
          id?: string
          kind: string
          language?: string
          link_id?: string | null
          org_id: string
          recipient_client_id: string
          sent_at?: string | null
          skip_reason?: string | null
          sms_message_id?: string | null
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          attempts?: number
          channel?: string
          client_id?: string
          created_at?: string
          event_at?: string | null
          id?: string
          kind?: string
          language?: string
          link_id?: string | null
          org_id?: string
          recipient_client_id?: string
          sent_at?: string | null
          skip_reason?: string | null
          sms_message_id?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_messages_appointment_fkey"
            columns: ["org_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      appointment_participants: {
        Row: {
          appointment_id: string
          client_id: string
          confirmed_at: string | null
          created_at: string
          org_id: string
          presence: string
          role: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          client_id: string
          confirmed_at?: string | null
          created_at?: string
          org_id: string
          presence?: string
          role?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          client_id?: string
          confirmed_at?: string | null
          created_at?: string
          org_id?: string
          presence?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_participants_appointment_fkey"
            columns: ["org_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointment_participants_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointment_participants_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      appointment_series: {
        Row: {
          created_at: string
          created_by: string | null
          first_starts_at: string
          id: string
          interval_weeks: number
          occurrences: number | null
          org_id: string
          professional_id: string
          service_id: string
          skipped_on: string[]
          until_on: string | null
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          first_starts_at: string
          id?: string
          interval_weeks: number
          occurrences?: number | null
          org_id: string
          professional_id: string
          service_id: string
          skipped_on?: string[]
          until_on?: string | null
          weekdays: number[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          first_starts_at?: string
          id?: string
          interval_weeks?: number
          occurrences?: number | null
          org_id?: string
          professional_id?: string
          service_id?: string
          skipped_on?: string[]
          until_on?: string | null
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "appointment_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointment_series_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointment_series_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointment_series_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointment_series_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "appointment_series_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointment_series_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      appointment_settings: {
        Row: {
          business_days: number[]
          business_end: string
          business_start: string
          late_notice_business_hours: boolean
          org_id: string
          reminder_business_days: number
          reminder_local_hour: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_days?: number[]
          business_end?: string
          business_start?: string
          late_notice_business_hours?: boolean
          org_id: string
          reminder_business_days?: number
          reminder_local_hour?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_days?: number[]
          business_end?: string
          business_start?: string
          late_notice_business_hours?: boolean
          org_id?: string
          reminder_business_days?: number
          reminder_local_hour?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      appointment_video_meetings: {
        Row: {
          appointment_id: string
          connection_id: string
          created_at: string
          emailed_join_url: string | null
          external_id: string
          join_url: string
          org_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          connection_id: string
          created_at?: string
          emailed_join_url?: string | null
          external_id: string
          join_url: string
          org_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          connection_id?: string
          created_at?: string
          emailed_join_url?: string | null
          external_id?: string
          join_url?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_video_meetings_appointment_fkey"
            columns: ["org_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointment_video_meetings_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "video_connections"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      appointments: {
        Row: {
          balance_override_by: string | null
          balance_override_reason: string | null
          blocks_until: string
          cancel_details: string | null
          cancel_late: boolean | null
          cancel_reason_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_message: string | null
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          external_ref: string | null
          held_until: string | null
          hold_reference: string | null
          id: string
          internal_note: string | null
          is_personal: boolean
          is_work: boolean
          kept_on_schedule: boolean
          mode: string
          org_id: string
          outside_availability_by: string | null
          outside_availability_reason: string | null
          personal_label: string | null
          professional_id: string
          series_id: string | null
          service_id: string | null
          starts_at: string
          state: string
          updated_at: string
          video_external_id: string | null
          video_status: string | null
          video_url: string | null
        }
        Insert: {
          balance_override_by?: string | null
          balance_override_reason?: string | null
          blocks_until: string
          cancel_details?: string | null
          cancel_late?: boolean | null
          cancel_reason_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_message?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          external_ref?: string | null
          held_until?: string | null
          hold_reference?: string | null
          id?: string
          internal_note?: string | null
          is_personal?: boolean
          is_work?: boolean
          kept_on_schedule?: boolean
          mode?: string
          org_id: string
          outside_availability_by?: string | null
          outside_availability_reason?: string | null
          personal_label?: string | null
          professional_id: string
          series_id?: string | null
          service_id?: string | null
          starts_at: string
          state?: string
          updated_at?: string
          video_external_id?: string | null
          video_status?: string | null
          video_url?: string | null
        }
        Update: {
          balance_override_by?: string | null
          balance_override_reason?: string | null
          blocks_until?: string
          cancel_details?: string | null
          cancel_late?: boolean | null
          cancel_reason_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_message?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          external_ref?: string | null
          held_until?: string | null
          hold_reference?: string | null
          id?: string
          internal_note?: string | null
          is_personal?: boolean
          is_work?: boolean
          kept_on_schedule?: boolean
          mode?: string
          org_id?: string
          outside_availability_by?: string | null
          outside_availability_reason?: string | null
          personal_label?: string | null
          professional_id?: string
          series_id?: string | null
          service_id?: string | null
          starts_at?: string
          state?: string
          updated_at?: string
          video_external_id?: string | null
          video_status?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_balance_override_by_fkey"
            columns: ["balance_override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointments_cancel_reason_fkey"
            columns: ["org_id", "cancel_reason_id"]
            isOneToOne: false
            referencedRelation: "cancellation_reasons"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointments_outside_availability_by_fkey"
            columns: ["outside_availability_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointments_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointments_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointments_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointments_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "appointments_series_fkey"
            columns: ["org_id", "series_id"]
            isOneToOne: false
            referencedRelation: "appointment_series"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointments_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "appointments_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          changed_fields: Json | null
          created_at: string
          id: number
          org_id: string | null
          record_id: string
          source: string
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: never
          org_id?: string | null
          record_id: string
          source?: string
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          changed_fields?: Json | null
          created_at?: string
          id?: never
          org_id?: string | null
          record_id?: string
          source?: string
          table_name?: string
        }
        Relationships: []
      }
      availability_exceptions: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          kind: string
          label: string | null
          org_id: string
          professional_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          kind: string
          label?: string | null
          org_id: string
          professional_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          kind?: string
          label?: string | null
          org_id?: string
          professional_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "availability_exceptions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "availability_exceptions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "availability_exceptions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "availability_exceptions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          org_id: string
          overflow_allowed: boolean
          professional_id: string
          service_ids: string[]
          start_time: string
          updated_at: string
          valid_from: string
          valid_until: string | null
          visible_to_clients: boolean
          weekday: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          org_id: string
          overflow_allowed?: boolean
          professional_id: string
          service_ids?: string[]
          start_time: string
          updated_at?: string
          valid_from: string
          valid_until?: string | null
          visible_to_clients?: boolean
          weekday: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          org_id?: string
          overflow_allowed?: boolean
          professional_id?: string
          service_ids?: string[]
          start_time?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
          visible_to_clients?: boolean
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "availability_rules_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "availability_rules_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "availability_rules_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "availability_rules_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      billing_deliveries: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          created_by: string | null
          credit_note_id: string | null
          email_log_id: string | null
          email_status: string | null
          error_code: string | null
          explicit: boolean
          finished_at: string | null
          id: string
          invoice_id: string | null
          kind: string
          next_attempt_at: string
          org_id: string
          receipt_id: string | null
          send_email: boolean
          skip_reason: string | null
          statement_id: string | null
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          created_by?: string | null
          credit_note_id?: string | null
          email_log_id?: string | null
          email_status?: string | null
          error_code?: string | null
          explicit?: boolean
          finished_at?: string | null
          id?: string
          invoice_id?: string | null
          kind: string
          next_attempt_at?: string
          org_id: string
          receipt_id?: string | null
          send_email: boolean
          skip_reason?: string | null
          statement_id?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          created_by?: string | null
          credit_note_id?: string | null
          email_log_id?: string | null
          email_status?: string | null
          error_code?: string | null
          explicit?: boolean
          finished_at?: string | null
          id?: string
          invoice_id?: string | null
          kind?: string
          next_attempt_at?: string
          org_id?: string
          receipt_id?: string | null
          send_email?: boolean
          skip_reason?: string | null
          statement_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_deliveries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "billing_deliveries_credit_note_fkey"
            columns: ["org_id", "credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_deliveries_email_log_id_fkey"
            columns: ["email_log_id"]
            isOneToOne: false
            referencedRelation: "email_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_deliveries_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_deliveries_receipt_fkey"
            columns: ["org_id", "receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_deliveries_statement_fkey"
            columns: ["org_id", "statement_id"]
            isOneToOne: false
            referencedRelation: "statements"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      billing_dunning_runs: {
        Row: {
          created_at: string
          delivery_id: string | null
          invoice_id: string
          org_id: string
          run_on: string
          step: number
        }
        Insert: {
          created_at?: string
          delivery_id?: string | null
          invoice_id: string
          org_id: string
          run_on: string
          step: number
        }
        Update: {
          created_at?: string
          delivery_id?: string | null
          invoice_id?: string
          org_id?: string
          run_on?: string
          step?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_dunning_runs_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "billing_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_dunning_runs_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      billing_payer_defaults: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          org_id: string
          payer_client_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          id?: string
          org_id: string
          payer_client_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          org_id?: string
          payer_client_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_payer_defaults_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_payer_defaults_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_payer_defaults_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "billing_payer_defaults_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_payer_defaults_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      billing_payer_rates: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          kind: string
          org_id: string
          session_cents: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          kind: string
          org_id: string
          session_cents: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          kind?: string
          org_id?: string
          session_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_payer_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "billing_payer_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_policies: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          fee_mode: string
          file_opening_service_id: string | null
          first_fee_percent: number
          id: string
          late_notice_hours: number
          next_fee_percent: number
          org_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          fee_mode?: string
          file_opening_service_id?: string | null
          first_fee_percent?: number
          id?: string
          late_notice_hours?: number
          next_fee_percent?: number
          org_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          fee_mode?: string
          file_opening_service_id?: string | null
          first_fee_percent?: number
          id?: string
          late_notice_hours?: number
          next_fee_percent?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "billing_policies_file_opening_fkey"
            columns: ["org_id", "file_opening_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_policies_file_opening_fkey"
            columns: ["org_id", "file_opening_service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_queue_items: {
        Row: {
          appointment_id: string
          created_at: string
          invoice_id: string | null
          org_id: string
          problem: string | null
          queued_on: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          invoice_id?: string | null
          org_id: string
          problem?: string | null
          queued_on: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          invoice_id?: string | null
          org_id?: string
          problem?: string | null
          queued_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_queue_items_appointment_fkey"
            columns: ["org_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "billing_queue_items_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      billing_settings: {
        Row: {
          block_after_days: number
          dunning_days: number[]
          dunning_from: string | null
          invoice_note_en: string | null
          invoice_note_fr: string | null
          org_id: string
          queue_from: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          block_after_days?: number
          dunning_days?: number[]
          dunning_from?: string | null
          invoice_note_en?: string | null
          invoice_note_fr?: string | null
          org_id: string
          queue_from?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          block_after_days?: number
          dunning_days?: number[]
          dunning_from?: string | null
          invoice_note_en?: string | null
          invoice_note_fr?: string | null
          org_id?: string
          queue_from?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      billing_source_hooks: {
        Row: {
          function_name: string
          module_key: string
          source_type: string
        }
        Insert: {
          function_name: string
          module_key: string
          source_type: string
        }
        Update: {
          function_name?: string
          module_key?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_source_hooks_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      billing_sync_events: {
        Row: {
          attempts: number
          created_at: string
          entity_id: string
          id: number
          invoice_id: string
          kind: string
          last_error_code: string | null
          org_id: string
          processed_at: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          entity_id: string
          id?: never
          invoice_id: string
          kind: string
          last_error_code?: string | null
          org_id: string
          processed_at?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          entity_id?: string
          id?: never
          invoice_id?: string
          kind?: string
          last_error_code?: string | null
          org_id?: string
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_sync_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connection_tokens: {
        Row: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          created_at: string
          key_version: number
          org_id: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          created_at?: string
          key_version?: number
          org_id: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          connection_id?: string
          created_at?: string
          key_version?: number
          org_id?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connection_tokens_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          account_email: string | null
          connected_at: string | null
          connected_by: string | null
          created_at: string
          disconnected_at: string | null
          external_user_id: string | null
          id: string
          org_id: string
          professional_id: string
          provider: string
          reconnect_reason: string | null
          scopes: string[]
          state: string
          updated_at: string
        }
        Insert: {
          account_email?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          external_user_id?: string | null
          id?: string
          org_id: string
          professional_id: string
          provider?: string
          reconnect_reason?: string | null
          scopes?: string[]
          state?: string
          updated_at?: string
        }
        Update: {
          account_email?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          external_user_id?: string | null
          id?: string
          org_id?: string
          professional_id?: string
          provider?: string
          reconnect_reason?: string | null
          scopes?: string[]
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "calendar_connections_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "calendar_connections_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "calendar_connections_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "calendar_connections_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      calendar_sync_status: {
        Row: {
          connection_id: string
          last_sync_error: string | null
          last_synced_at: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sync_status_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      cancellation_fee_decisions: {
        Row: {
          amount_cents: number | null
          appointment_id: string
          client_id: string
          created_at: string
          decided_as: string | null
          decided_at: string | null
          decided_by: string | null
          fee_percent: number | null
          invoice_id: string | null
          kind: string
          note: string | null
          org_id: string
          professional_id: string
          status: string
        }
        Insert: {
          amount_cents?: number | null
          appointment_id: string
          client_id: string
          created_at?: string
          decided_as?: string | null
          decided_at?: string | null
          decided_by?: string | null
          fee_percent?: number | null
          invoice_id?: string | null
          kind: string
          note?: string | null
          org_id: string
          professional_id: string
          status?: string
        }
        Update: {
          amount_cents?: number | null
          appointment_id?: string
          client_id?: string
          created_at?: string
          decided_as?: string | null
          decided_at?: string | null
          decided_by?: string | null
          fee_percent?: number | null
          invoice_id?: string | null
          kind?: string
          note?: string | null
          org_id?: string
          professional_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_fee_decisions_appointment_fkey"
            columns: ["org_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cancellation_fee_decisions_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cancellation_fee_decisions_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cancellation_fee_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cancellation_fee_decisions_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cancellation_fee_decisions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cancellation_fee_decisions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cancellation_fee_decisions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cancellation_fee_decisions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      cancellation_reasons: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_reasons_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_snapshots: {
        Row: {
          accepting_new_clients: boolean
          org_id: string
          places_declared: number | null
          places_left: number | null
          places_used: number | null
          professional_id: string
          snapshot_on: string
          taken_at: string
        }
        Insert: {
          accepting_new_clients: boolean
          org_id: string
          places_declared?: number | null
          places_left?: number | null
          places_used?: number | null
          professional_id: string
          snapshot_on: string
          taken_at?: string
        }
        Update: {
          accepting_new_clients?: boolean
          org_id?: string
          places_declared?: number | null
          places_left?: number | null
          places_used?: number | null
          professional_id?: string
          snapshot_on?: string
          taken_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capacity_snapshots_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "capacity_snapshots_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "capacity_snapshots_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "capacity_snapshots_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      client_anonymize_handlers: {
        Row: {
          function_name: string
          module_key: string
        }
        Insert: {
          function_name: string
          module_key: string
        }
        Update: {
          function_name?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_anonymize_handlers_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: true
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      client_consent_campaign_items: {
        Row: {
          campaign_id: string
          client_id: string
          created_at: string
          failure: string | null
          id: string
          org_id: string
          processed_at: string | null
          request_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          client_id: string
          created_at?: string
          failure?: string | null
          id?: string
          org_id: string
          processed_at?: string | null
          request_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          client_id?: string
          created_at?: string
          failure?: string | null
          id?: string
          org_id?: string
          processed_at?: string | null
          request_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_campaign_items_campaign_fkey"
            columns: ["org_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "client_consent_campaigns"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_campaign_items_campaign_fkey"
            columns: ["org_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "client_consent_campaigns_summary"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_campaign_items_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_campaign_items_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_campaign_items_request_fkey"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "client_consent_requests"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_campaign_items_request_fkey"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "client_consents_to_obtain"
            referencedColumns: ["org_id", "request_id"]
          },
        ]
      }
      client_consent_campaigns: {
        Row: {
          cancelled_by: string | null
          consent_key: string
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          org_id: string
          state: string
          total: number
          updated_at: string
        }
        Insert: {
          cancelled_by?: string | null
          consent_key: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          org_id: string
          state?: string
          total?: number
          updated_at?: string
        }
        Update: {
          cancelled_by?: string | null
          consent_key?: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          org_id?: string
          state?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_campaigns_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_consent_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_consent_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_consent_campaigns_type_fkey"
            columns: ["org_id", "consent_key"]
            isOneToOne: false
            referencedRelation: "client_consent_types"
            referencedColumns: ["org_id", "key"]
          },
        ]
      }
      client_consent_request_signers: {
        Row: {
          created_at: string
          id: string
          identity_failures: number
          last_sent_at: string | null
          link_id: string | null
          opened_at: string | null
          org_id: string
          relation_id: string | null
          request_id: string
          role: string
          signer_client_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          identity_failures?: number
          last_sent_at?: string | null
          link_id?: string | null
          opened_at?: string | null
          org_id: string
          relation_id?: string | null
          request_id: string
          role: string
          signer_client_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          identity_failures?: number
          last_sent_at?: string | null
          link_id?: string | null
          opened_at?: string | null
          org_id?: string
          relation_id?: string | null
          request_id?: string
          role?: string
          signer_client_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_request_signers_link_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "secure_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_consent_request_signers_relation_fkey"
            columns: ["relation_id"]
            isOneToOne: false
            referencedRelation: "client_relations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_consent_request_signers_request_fkey"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "client_consent_requests"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_request_signers_request_fkey"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "client_consents_to_obtain"
            referencedColumns: ["org_id", "request_id"]
          },
          {
            foreignKeyName: "client_consent_request_signers_signer_fkey"
            columns: ["org_id", "signer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_request_signers_signer_fkey"
            columns: ["org_id", "signer_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_consent_requests: {
        Row: {
          answered_at: string | null
          answers: Json | null
          cancelled_at: string | null
          cancelled_by: string | null
          clauses: Json
          client_id: string
          consent_key: string
          context_id: string | null
          context_type: string | null
          created_at: string
          due_at: string | null
          id: string
          language: string
          last_sent_at: string
          org_id: string
          reminded_at: string | null
          requested_by: string | null
          signed_at: string | null
          state: string
          template_version_id: string
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          answers?: Json | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          clauses?: Json
          client_id: string
          consent_key: string
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          language: string
          last_sent_at?: string
          org_id: string
          reminded_at?: string | null
          requested_by?: string | null
          signed_at?: string | null
          state?: string
          template_version_id: string
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          answers?: Json | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          clauses?: Json
          client_id?: string
          consent_key?: string
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          language?: string
          last_sent_at?: string
          org_id?: string
          reminded_at?: string | null
          requested_by?: string | null
          signed_at?: string | null
          state?: string
          template_version_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_consent_requests_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_requests_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_consent_requests_type_fkey"
            columns: ["org_id", "consent_key"]
            isOneToOne: false
            referencedRelation: "client_consent_types"
            referencedColumns: ["org_id", "key"]
          },
          {
            foreignKeyName: "client_consent_requests_version_fkey"
            columns: ["template_version_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      client_consent_rules: {
        Row: {
          consent_key: string
          created_at: string
          created_by: string | null
          frequency: string
          id: string
          is_active: boolean
          org_id: string
          target: string | null
          trigger_kind: string
          updated_at: string
        }
        Insert: {
          consent_key: string
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          org_id: string
          target?: string | null
          trigger_kind: string
          updated_at?: string
        }
        Update: {
          consent_key?: string
          created_at?: string
          created_by?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          org_id?: string
          target?: string | null
          trigger_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_consent_rules_type_fkey"
            columns: ["org_id", "consent_key"]
            isOneToOne: false
            referencedRelation: "client_consent_types"
            referencedColumns: ["org_id", "key"]
          },
        ]
      }
      client_consent_settings: {
        Row: {
          due_days_before_first_appointment: number
          org_id: string
          pre_appointment_reminder_hours: number
          reminder_days: number
          retention_policy: string | null
          signed_pdf_retention_years: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          due_days_before_first_appointment?: number
          org_id: string
          pre_appointment_reminder_hours?: number
          reminder_days?: number
          retention_policy?: string | null
          signed_pdf_retention_years?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          due_days_before_first_appointment?: number
          org_id?: string
          pre_appointment_reminder_hours?: number
          reminder_days?: number
          retention_policy?: string | null
          signed_pdf_retention_years?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_consent_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_consent_types: {
        Row: {
          clauses: Json
          created_at: string
          id: string
          is_active: boolean
          key: string
          name_en: string
          name_fr: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          clauses?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          name_en: string
          name_fr: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          clauses?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          name_en?: string
          name_fr?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_consent_version_clauses: {
        Row: {
          clauses: Json
          created_at: string
          org_id: string
          updated_at: string
          updated_by: string | null
          version_id: string
        }
        Insert: {
          clauses: Json
          created_at?: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
          version_id: string
        }
        Update: {
          clauses?: Json
          created_at?: string
          org_id?: string
          updated_at?: string
          updated_by?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_version_clauses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_consent_version_clauses_version_fkey"
            columns: ["version_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      client_consents: {
        Row: {
          answers: Json | null
          client_id: string
          consent_key: string
          copy_sent_at: string | null
          copy_sent_by: string | null
          created_at: string
          id: string
          language: string
          org_id: string
          request_id: string | null
          resign_requested_at: string | null
          signed_at: string
          signed_by: Json
          signed_file_id: string | null
          source: string
          superseded_at: string | null
          template_version_id: string | null
          updated_at: string
          version_label: string
          withdrawal_note: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        Insert: {
          answers?: Json | null
          client_id: string
          consent_key: string
          copy_sent_at?: string | null
          copy_sent_by?: string | null
          created_at?: string
          id?: string
          language: string
          org_id: string
          request_id?: string | null
          resign_requested_at?: string | null
          signed_at: string
          signed_by?: Json
          signed_file_id?: string | null
          source?: string
          superseded_at?: string | null
          template_version_id?: string | null
          updated_at?: string
          version_label: string
          withdrawal_note?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          answers?: Json | null
          client_id?: string
          consent_key?: string
          copy_sent_at?: string | null
          copy_sent_by?: string | null
          created_at?: string
          id?: string
          language?: string
          org_id?: string
          request_id?: string | null
          resign_requested_at?: string | null
          signed_at?: string
          signed_by?: Json
          signed_file_id?: string | null
          source?: string
          superseded_at?: string | null
          template_version_id?: string | null
          updated_at?: string
          version_label?: string
          withdrawal_note?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_consents_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consents_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consents_copy_sent_by_fkey"
            columns: ["copy_sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_consents_request_fkey"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "client_consent_requests"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consents_request_fkey"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "client_consents_to_obtain"
            referencedColumns: ["org_id", "request_id"]
          },
          {
            foreignKeyName: "client_consents_signed_file_id_fkey"
            columns: ["signed_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_consents_type_fkey"
            columns: ["org_id", "consent_key"]
            isOneToOne: false
            referencedRelation: "client_consent_types"
            referencedColumns: ["org_id", "key"]
          },
          {
            foreignKeyName: "client_consents_version_fkey"
            columns: ["template_version_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "client_consents_withdrawn_by_fkey"
            columns: ["withdrawn_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_insurances: {
        Row: {
          certificate_number: string | null
          client_id: string
          created_at: string
          holder_name: string | null
          holder_relation: string
          insurer: string
          org_id: string
          policy_number: string | null
          rank: number
          updated_at: string
        }
        Insert: {
          certificate_number?: string | null
          client_id: string
          created_at?: string
          holder_name?: string | null
          holder_relation?: string
          insurer: string
          org_id: string
          policy_number?: string | null
          rank: number
          updated_at?: string
        }
        Update: {
          certificate_number?: string | null
          client_id?: string
          created_at?: string
          holder_name?: string | null
          holder_relation?: string
          insurer?: string
          org_id?: string
          policy_number?: string | null
          rank?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_insurances_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_insurances_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_merge_handlers: {
        Row: {
          function_name: string
          module_key: string
        }
        Insert: {
          function_name: string
          module_key: string
        }
        Update: {
          function_name?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_merge_handlers_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: true
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      client_merges: {
        Row: {
          id: string
          kept_client_id: string
          merged_at: string
          merged_by: string | null
          merged_client_id: string
          moved: Json
          org_id: string
        }
        Insert: {
          id?: string
          kept_client_id: string
          merged_at?: string
          merged_by?: string | null
          merged_client_id: string
          moved?: Json
          org_id: string
        }
        Update: {
          id?: string
          kept_client_id?: string
          merged_at?: string
          merged_by?: string | null
          merged_client_id?: string
          moved?: Json
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_merges_kept_fkey"
            columns: ["org_id", "kept_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_merges_kept_fkey"
            columns: ["org_id", "kept_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_merges_merged_fkey"
            columns: ["org_id", "merged_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_merges_merged_fkey"
            columns: ["org_id", "merged_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_notes: {
        Row: {
          admin_notes: string | null
          client_id: string
          org_id: string
          special_agreement_note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_notes?: string | null
          client_id: string
          org_id: string
          special_agreement_note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_notes?: string | null
          client_id?: string
          org_id?: string
          special_agreement_note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_notes_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_payer_organisations: {
        Row: {
          client_payer_id: string
          created_at: string
          created_by: string | null
          org_id: string
          organisation_id: string
        }
        Insert: {
          client_payer_id: string
          created_at?: string
          created_by?: string | null
          org_id: string
          organisation_id: string
        }
        Update: {
          client_payer_id?: string
          created_at?: string
          created_by?: string | null
          org_id?: string
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payer_organisations_client_payer_id_fkey"
            columns: ["client_payer_id"]
            isOneToOne: true
            referencedRelation: "client_payers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payer_organisations_client_payer_id_fkey"
            columns: ["client_payer_id"]
            isOneToOne: true
            referencedRelation: "client_payers_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_payer_organisations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_payer_organisations_organisation_fkey"
            columns: ["org_id", "organisation_id"]
            isOneToOne: false
            referencedRelation: "payer_organisations"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_payers: {
        Row: {
          client_id: string
          coverage_percent: number | null
          created_at: string
          created_by: string | null
          expires_on: string | null
          file_number: string | null
          id: string
          is_active: boolean
          is_stub: boolean
          kind: string
          max_amount_cents: number | null
          max_sessions: number | null
          note: string | null
          org_id: string
          organisation_name: string | null
          prior_used_cents: number | null
          prior_used_on: string | null
          prior_used_sessions: number | null
          renewal_day: number | null
          renewal_month: number | null
          session_amount_cents: number | null
          starts_on: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          coverage_percent?: number | null
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          file_number?: string | null
          id?: string
          is_active?: boolean
          is_stub?: boolean
          kind: string
          max_amount_cents?: number | null
          max_sessions?: number | null
          note?: string | null
          org_id: string
          organisation_name?: string | null
          prior_used_cents?: number | null
          prior_used_on?: string | null
          prior_used_sessions?: number | null
          renewal_day?: number | null
          renewal_month?: number | null
          session_amount_cents?: number | null
          starts_on?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          coverage_percent?: number | null
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          file_number?: string | null
          id?: string
          is_active?: boolean
          is_stub?: boolean
          kind?: string
          max_amount_cents?: number | null
          max_sessions?: number | null
          note?: string | null
          org_id?: string
          organisation_name?: string | null
          prior_used_cents?: number | null
          prior_used_on?: string | null
          prior_used_sessions?: number | null
          renewal_day?: number | null
          renewal_month?: number | null
          session_amount_cents?: number | null
          starts_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_payers_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_payers_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_payers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_professional_links: {
        Row: {
          client_id: string
          first_linked_at: string
          last_linked_at: string
          org_id: string
          professional_id: string
          reason: string
        }
        Insert: {
          client_id: string
          first_linked_at?: string
          last_linked_at?: string
          org_id: string
          professional_id: string
          reason: string
        }
        Update: {
          client_id?: string
          first_linked_at?: string
          last_linked_at?: string
          org_id?: string
          professional_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_professional_links_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_professional_links_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_professional_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_professional_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_professional_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_professional_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      client_relations: {
        Row: {
          a_main_contact: boolean
          a_manages_appointments: boolean
          a_receives_communications: boolean
          a_receives_invoices: boolean
          b_main_contact: boolean
          b_manages_appointments: boolean
          b_receives_communications: boolean
          b_receives_invoices: boolean
          client_a_id: string
          client_b_id: string
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          type_a_to_b: string
          type_b_to_a: string
          updated_at: string
        }
        Insert: {
          a_main_contact?: boolean
          a_manages_appointments?: boolean
          a_receives_communications?: boolean
          a_receives_invoices?: boolean
          b_main_contact?: boolean
          b_manages_appointments?: boolean
          b_receives_communications?: boolean
          b_receives_invoices?: boolean
          client_a_id: string
          client_b_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          type_a_to_b: string
          type_b_to_a: string
          updated_at?: string
        }
        Update: {
          a_main_contact?: boolean
          a_manages_appointments?: boolean
          a_receives_communications?: boolean
          a_receives_invoices?: boolean
          b_main_contact?: boolean
          b_manages_appointments?: boolean
          b_receives_communications?: boolean
          b_receives_invoices?: boolean
          client_a_id?: string
          client_b_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          type_a_to_b?: string
          type_b_to_a?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_relations_a_fkey"
            columns: ["org_id", "client_a_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_relations_a_fkey"
            columns: ["org_id", "client_a_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_relations_b_fkey"
            columns: ["org_id", "client_b_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_relations_b_fkey"
            columns: ["org_id", "client_b_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_tag_links: {
        Row: {
          client_id: string
          created_at: string
          org_id: string
          tag_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          org_id: string
          tag_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          org_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tag_links_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_tag_links_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_tag_links_tag_fkey"
            columns: ["org_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "client_tags"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_tags: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clienteles: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          max_age: number | null
          min_age: number | null
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          max_age?: number | null
          min_age?: number | null
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          max_age?: number | null
          min_age?: number | null
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clienteles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          anonymized_at: string | null
          anonymized_by: string | null
          archived_at: string | null
          archived_by: string | null
          birth_first_name: string | null
          birthday: string | null
          city: string | null
          client_number: number
          country: string
          created_at: string
          created_by: string | null
          custom_field: string | null
          email: string | null
          external_ref: string | null
          file_incomplete: boolean
          first_name: string
          home_e164: string | null
          id: string
          is_banned: boolean
          language: string
          last_name: string
          merged_into_id: string | null
          mobile_e164: string | null
          org_id: string
          postal_code: string | null
          primary_professional_id: string | null
          pronouns: string | null
          province: string | null
          rate_variant: string | null
          referral_source_id: string | null
          referred_by: string | null
          referred_by_client_id: string | null
          reminders_by_email: boolean
          reminders_by_sms: boolean
          sex: string | null
          shared_custody: boolean
          special_agreement: boolean
          tax_exempt: boolean
          time_zone: string | null
          updated_at: string
          work_e164: string | null
          work_ext: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          anonymized_at?: string | null
          anonymized_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          birth_first_name?: string | null
          birthday?: string | null
          city?: string | null
          client_number: number
          country?: string
          created_at?: string
          created_by?: string | null
          custom_field?: string | null
          email?: string | null
          external_ref?: string | null
          file_incomplete?: boolean
          first_name: string
          home_e164?: string | null
          id?: string
          is_banned?: boolean
          language?: string
          last_name: string
          merged_into_id?: string | null
          mobile_e164?: string | null
          org_id: string
          postal_code?: string | null
          primary_professional_id?: string | null
          pronouns?: string | null
          province?: string | null
          rate_variant?: string | null
          referral_source_id?: string | null
          referred_by?: string | null
          referred_by_client_id?: string | null
          reminders_by_email?: boolean
          reminders_by_sms?: boolean
          sex?: string | null
          shared_custody?: boolean
          special_agreement?: boolean
          tax_exempt?: boolean
          time_zone?: string | null
          updated_at?: string
          work_e164?: string | null
          work_ext?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          anonymized_at?: string | null
          anonymized_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          birth_first_name?: string | null
          birthday?: string | null
          city?: string | null
          client_number?: number
          country?: string
          created_at?: string
          created_by?: string | null
          custom_field?: string | null
          email?: string | null
          external_ref?: string | null
          file_incomplete?: boolean
          first_name?: string
          home_e164?: string | null
          id?: string
          is_banned?: boolean
          language?: string
          last_name?: string
          merged_into_id?: string | null
          mobile_e164?: string | null
          org_id?: string
          postal_code?: string | null
          primary_professional_id?: string | null
          pronouns?: string | null
          province?: string | null
          rate_variant?: string | null
          referral_source_id?: string | null
          referred_by?: string | null
          referred_by_client_id?: string | null
          reminders_by_email?: boolean
          reminders_by_sms?: boolean
          sex?: string | null
          shared_custody?: boolean
          special_agreement?: boolean
          tax_exempt?: boolean
          time_zone?: string | null
          updated_at?: string
          work_e164?: string | null
          work_ext?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_anonymized_by_fkey"
            columns: ["anonymized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clients_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clients_merged_into_fkey"
            columns: ["org_id", "merged_into_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_merged_into_fkey"
            columns: ["org_id", "merged_into_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_primary_professional_fkey"
            columns: ["org_id", "primary_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_primary_professional_fkey"
            columns: ["org_id", "primary_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_primary_professional_fkey"
            columns: ["org_id", "primary_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_primary_professional_fkey"
            columns: ["org_id", "primary_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "clients_referral_source_fkey"
            columns: ["org_id", "referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_referral_source_fkey"
            columns: ["org_id", "referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_referred_by_client_fkey"
            columns: ["org_id", "referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_referred_by_client_fkey"
            columns: ["org_id", "referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      compensation_kinds: {
        Row: {
          key: string
          name: string
          sort_order: number
        }
        Insert: {
          key: string
          name: string
          sort_order: number
        }
        Update: {
          key?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      compensation_rates: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          kind: string
          org_id: string
          retention_pct: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          kind: string
          org_id: string
          retention_pct: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          kind?: string
          org_id?: string
          retention_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "compensation_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "compensation_rates_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "compensation_kinds"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "compensation_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_versions: {
        Row: {
          body: string
          created_at: string
          id: string
          key: string
          org_id: string
          published_at: string | null
          published_by: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          key: string
          org_id: string
          published_at?: string | null
          published_by?: string | null
          title: string
          updated_at?: string
          version: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          key?: string
          org_id?: string
          published_at?: string | null
          published_by?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "consent_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          created_at: string
          created_by: string | null
          gst_cents: number
          id: string
          invoice_id: string
          issued_on: string
          number: string
          org_id: string
          pdf_file_id: string | null
          qst_cents: number
          reason: string
          seq: number
          subtotal_cents: number
          total_cents: number
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          gst_cents: number
          id?: string
          invoice_id: string
          issued_on: string
          number: string
          org_id: string
          pdf_file_id?: string | null
          qst_cents: number
          reason: string
          seq: number
          subtotal_cents: number
          total_cents: number
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          gst_cents?: number
          id?: string
          invoice_id?: string
          issued_on?: string
          number?: string
          org_id?: string
          pdf_file_id?: string | null
          qst_cents?: number
          reason?: string
          seq?: number
          subtotal_cents?: number
          total_cents?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "credit_notes_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
        ]
      }
      deactivation_reasons: {
        Row: {
          created_at: string
          disables_account: boolean
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          name: string
          org_id: string
          requires_note: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          disables_account?: boolean
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          name: string
          org_id: string
          requires_note?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          disables_account?: boolean
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string
          requires_note?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deactivation_reasons_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      demande_events: {
        Row: {
          assignee: string | null
          at: string
          by_user: string | null
          closed_reason: string | null
          contact_channel: string | null
          contact_outcome: string | null
          demande_id: string
          from_state: string | null
          id: string
          kind: string
          org_id: string
          professional_id: string | null
          to_state: string | null
        }
        Insert: {
          assignee?: string | null
          at?: string
          by_user?: string | null
          closed_reason?: string | null
          contact_channel?: string | null
          contact_outcome?: string | null
          demande_id: string
          from_state?: string | null
          id?: string
          kind: string
          org_id: string
          professional_id?: string | null
          to_state?: string | null
        }
        Update: {
          assignee?: string | null
          at?: string
          by_user?: string | null
          closed_reason?: string | null
          contact_channel?: string | null
          contact_outcome?: string | null
          demande_id?: string
          from_state?: string | null
          id?: string
          kind?: string
          org_id?: string
          professional_id?: string | null
          to_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demande_events_assignee_fkey"
            columns: ["assignee", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
          {
            foreignKeyName: "demande_events_by_user_fkey"
            columns: ["by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "demande_events_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_events_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_events_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_events_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_events_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_events_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      demande_motifs: {
        Row: {
          created_at: string
          demande_id: string
          motif_id: string
          org_id: string
        }
        Insert: {
          created_at?: string
          demande_id: string
          motif_id: string
          org_id: string
        }
        Update: {
          created_at?: string
          demande_id?: string
          motif_id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "demande_motifs_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_motifs_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_motifs_motif_fkey"
            columns: ["org_id", "motif_id"]
            isOneToOne: false
            referencedRelation: "motifs"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_motifs_motif_fkey"
            columns: ["org_id", "motif_id"]
            isOneToOne: false
            referencedRelation: "motifs_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      demande_notes: {
        Row: {
          demande_id: string
          internal_note: string
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          demande_id: string
          internal_note: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          demande_id?: string
          internal_note?: string
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demande_notes_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_notes_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      demande_participants: {
        Row: {
          birthday: string | null
          client_id: string | null
          created_at: string
          demande_id: string
          display_name: string | null
          id: string
          is_primary: boolean
          org_id: string
          relationship: string
          updated_at: string
        }
        Insert: {
          birthday?: string | null
          client_id?: string | null
          created_at?: string
          demande_id: string
          display_name?: string | null
          id?: string
          is_primary?: boolean
          org_id: string
          relationship?: string
          updated_at?: string
        }
        Update: {
          birthday?: string | null
          client_id?: string | null
          created_at?: string
          demande_id?: string
          display_name?: string | null
          id?: string
          is_primary?: boolean
          org_id?: string
          relationship?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demande_participants_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_participants_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_participants_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_participants_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes_sources"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      demande_propositions: {
        Row: {
          accepted_appointment_id: string | null
          accepted_starts_at: string | null
          created_at: string
          decline_reason: string | null
          demande_id: string
          directory_snapshot: Json
          directory_updated_at: string | null
          expires_at: string | null
          id: string
          language: string | null
          mode: string | null
          org_id: string
          professional_id: string
          proposed_at: string
          proposed_by: string | null
          responded_at: string | null
          response: string
          secure_link_id: string | null
          service_id: string | null
          slots: Json
          updated_at: string
        }
        Insert: {
          accepted_appointment_id?: string | null
          accepted_starts_at?: string | null
          created_at?: string
          decline_reason?: string | null
          demande_id: string
          directory_snapshot?: Json
          directory_updated_at?: string | null
          expires_at?: string | null
          id?: string
          language?: string | null
          mode?: string | null
          org_id: string
          professional_id: string
          proposed_at?: string
          proposed_by?: string | null
          responded_at?: string | null
          response?: string
          secure_link_id?: string | null
          service_id?: string | null
          slots?: Json
          updated_at?: string
        }
        Update: {
          accepted_appointment_id?: string | null
          accepted_starts_at?: string | null
          created_at?: string
          decline_reason?: string | null
          demande_id?: string
          directory_snapshot?: Json
          directory_updated_at?: string | null
          expires_at?: string | null
          id?: string
          language?: string | null
          mode?: string | null
          org_id?: string
          professional_id?: string
          proposed_at?: string
          proposed_by?: string | null
          responded_at?: string | null
          response?: string
          secure_link_id?: string | null
          service_id?: string | null
          slots?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demande_propositions_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_propositions_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_propositions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_propositions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_propositions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_propositions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "demande_propositions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      demande_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          demande_id: string
          done_at: string | null
          done_by: string | null
          due_at: string
          id: string
          kind: string
          org_id: string
          outcome: string | null
          state: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          demande_id: string
          done_at?: string | null
          done_by?: string | null
          due_at: string
          id?: string
          kind: string
          org_id: string
          outcome?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          demande_id?: string
          done_at?: string | null
          done_by?: string | null
          due_at?: string
          id?: string
          kind?: string
          org_id?: string
          outcome?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demande_tasks_assigned_to_fkey"
            columns: ["assigned_to", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
          {
            foreignKeyName: "demande_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "demande_tasks_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_tasks_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demande_tasks_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      demandes: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          availability_days: number[]
          availability_other: string | null
          availability_periods: string[]
          beneficiary: string | null
          channel: string
          client_id: string | null
          clientele_id: string | null
          closed_at: string | null
          closed_reason: string | null
          concerns: string | null
          contact_attempts: number
          contact_email: string | null
          contact_name: string | null
          contact_phone_e164: string | null
          created_at: string
          created_by: string | null
          external_ref: string | null
          handled_at: string | null
          handled_by: string | null
          has_issues: boolean | null
          has_legal_context: boolean | null
          id: string
          insurer: string | null
          is_urgent: boolean
          issues: string[]
          issues_comment: string | null
          language: string
          last_contact_at: string | null
          legal_context: string[]
          legal_detail: string | null
          matched_at: string | null
          matched_professional_id: string | null
          modality: string
          motif_other: string | null
          next_contact_at: string | null
          org_id: string
          payer_kind: string
          preferred_pro_gender: string
          previous_comment: string | null
          previous_professionals: string[]
          previous_therapy: boolean | null
          profession_title_id: string | null
          received_at: string
          received_by: string | null
          reference: string
          reference_seq: number
          reference_year: number
          referral_source_id: string | null
          source_campaign: string | null
          source_landing_page: string | null
          source_referrer: string | null
          source_utm: Json
          state: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          availability_days?: number[]
          availability_other?: string | null
          availability_periods?: string[]
          beneficiary?: string | null
          channel?: string
          client_id?: string | null
          clientele_id?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          concerns?: string | null
          contact_attempts?: number
          contact_email?: string | null
          contact_name?: string | null
          contact_phone_e164?: string | null
          created_at?: string
          created_by?: string | null
          external_ref?: string | null
          handled_at?: string | null
          handled_by?: string | null
          has_issues?: boolean | null
          has_legal_context?: boolean | null
          id?: string
          insurer?: string | null
          is_urgent?: boolean
          issues?: string[]
          issues_comment?: string | null
          language?: string
          last_contact_at?: string | null
          legal_context?: string[]
          legal_detail?: string | null
          matched_at?: string | null
          matched_professional_id?: string | null
          modality?: string
          motif_other?: string | null
          next_contact_at?: string | null
          org_id: string
          payer_kind?: string
          preferred_pro_gender?: string
          previous_comment?: string | null
          previous_professionals?: string[]
          previous_therapy?: boolean | null
          profession_title_id?: string | null
          received_at?: string
          received_by?: string | null
          reference: string
          reference_seq: number
          reference_year: number
          referral_source_id?: string | null
          source_campaign?: string | null
          source_landing_page?: string | null
          source_referrer?: string | null
          source_utm?: Json
          state?: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          availability_days?: number[]
          availability_other?: string | null
          availability_periods?: string[]
          beneficiary?: string | null
          channel?: string
          client_id?: string | null
          clientele_id?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          concerns?: string | null
          contact_attempts?: number
          contact_email?: string | null
          contact_name?: string | null
          contact_phone_e164?: string | null
          created_at?: string
          created_by?: string | null
          external_ref?: string | null
          handled_at?: string | null
          handled_by?: string | null
          has_issues?: boolean | null
          has_legal_context?: boolean | null
          id?: string
          insurer?: string | null
          is_urgent?: boolean
          issues?: string[]
          issues_comment?: string | null
          language?: string
          last_contact_at?: string | null
          legal_context?: string[]
          legal_detail?: string | null
          matched_at?: string | null
          matched_professional_id?: string | null
          modality?: string
          motif_other?: string | null
          next_contact_at?: string | null
          org_id?: string
          payer_kind?: string
          preferred_pro_gender?: string
          previous_comment?: string | null
          previous_professionals?: string[]
          previous_therapy?: boolean | null
          profession_title_id?: string | null
          received_at?: string
          received_by?: string | null
          reference?: string
          reference_seq?: number
          reference_year?: number
          referral_source_id?: string | null
          source_campaign?: string | null
          source_landing_page?: string | null
          source_referrer?: string | null
          source_utm?: Json
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demandes_assigned_to_fkey"
            columns: ["assigned_to", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
          {
            foreignKeyName: "demandes_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_clientele_fkey"
            columns: ["org_id", "clientele_id"]
            isOneToOne: false
            referencedRelation: "clienteles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_clientele_fkey"
            columns: ["org_id", "clientele_id"]
            isOneToOne: false
            referencedRelation: "clienteles_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "demandes_handled_by_fkey"
            columns: ["handled_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
          {
            foreignKeyName: "demandes_matched_professional_fkey"
            columns: ["org_id", "matched_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_matched_professional_fkey"
            columns: ["org_id", "matched_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_matched_professional_fkey"
            columns: ["org_id", "matched_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_matched_professional_fkey"
            columns: ["org_id", "matched_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "demandes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demandes_profession_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_profession_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "demandes_referral_source_fkey"
            columns: ["org_id", "referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_referral_source_fkey"
            columns: ["org_id", "referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      document_template_versions: {
        Row: {
          archived_at: string | null
          body: Json
          created_at: string
          created_by: string | null
          email_message: string
          email_subject: string
          id: string
          org_id: string
          published_at: string | null
          published_by: string | null
          signers: Json
          status: string
          template_id: string
          updated_at: string
          variables: Json
          version: number
        }
        Insert: {
          archived_at?: string | null
          body?: Json
          created_at?: string
          created_by?: string | null
          email_message?: string
          email_subject?: string
          id?: string
          org_id: string
          published_at?: string | null
          published_by?: string | null
          signers?: Json
          status?: string
          template_id: string
          updated_at?: string
          variables?: Json
          version: number
        }
        Update: {
          archived_at?: string | null
          body?: Json
          created_at?: string
          created_by?: string | null
          email_message?: string
          email_subject?: string
          id?: string
          org_id?: string
          published_at?: string | null
          published_by?: string | null
          signers?: Json
          status?: string
          template_id?: string
          updated_at?: string
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_template_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "document_template_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "document_template_versions_template_id_org_id_fkey"
            columns: ["template_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      document_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          edit_permission: string
          id: string
          is_active: boolean
          key: string
          module_key: string
          org_id: string
          title: string
          updated_at: string
          view_permission: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edit_permission: string
          id?: string
          is_active?: boolean
          key: string
          module_key: string
          org_id: string
          title: string
          updated_at?: string
          view_permission: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edit_permission?: string
          id?: string
          is_active?: boolean
          key?: string
          module_key?: string
          org_id?: string
          title?: string
          updated_at?: string
          view_permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "document_templates_edit_permission_module_key_fkey"
            columns: ["edit_permission", "module_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key", "module_key"]
          },
          {
            foreignKeyName: "document_templates_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "document_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_view_permission_module_key_fkey"
            columns: ["view_permission", "module_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key", "module_key"]
          },
        ]
      }
      document_types: {
        Row: {
          accepted_mime: string[]
          created_at: string
          expiry_rule: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          max_bytes: number
          name: string
          org_id: string
          reminder_days: number[]
          required: boolean
          sort_order: number
          updated_at: string
          weekly_after_expiry: boolean
        }
        Insert: {
          accepted_mime: string[]
          created_at?: string
          expiry_rule?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          max_bytes: number
          name: string
          org_id: string
          reminder_days?: number[]
          required?: boolean
          sort_order?: number
          updated_at?: string
          weekly_after_expiry?: boolean
        }
        Update: {
          accepted_mime?: string[]
          created_at?: string
          expiry_rule?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          max_bytes?: number
          name?: string
          org_id?: string
          reminder_days?: number[]
          required?: boolean
          sort_order?: number
          updated_at?: string
          weekly_after_expiry?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "document_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          attachment_count: number
          attempts: number
          created_at: string
          error_code: string | null
          id: string
          last_event_at: string | null
          module_key: string
          org_id: string
          resend_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          subject_id: string
          subject_type: string
          template_key: string
          template_version: number
          to_email: string | null
          to_profile_id: string | null
          view_permission: string
        }
        Insert: {
          attachment_count?: number
          attempts?: number
          created_at?: string
          error_code?: string | null
          id?: string
          last_event_at?: string | null
          module_key: string
          org_id: string
          resend_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject_id: string
          subject_type: string
          template_key: string
          template_version: number
          to_email?: string | null
          to_profile_id?: string | null
          view_permission: string
        }
        Update: {
          attachment_count?: number
          attempts?: number
          created_at?: string
          error_code?: string | null
          id?: string
          last_event_at?: string | null
          module_key?: string
          org_id?: string
          resend_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject_id?: string
          subject_type?: string
          template_key?: string
          template_version?: number
          to_email?: string | null
          to_profile_id?: string | null
          view_permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "email_log_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "email_template_defaults"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "email_log_to_profile_id_fkey"
            columns: ["to_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "email_log_view_permission_fkey"
            columns: ["view_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      email_settings: {
        Row: {
          from_address: string
          from_name: string
          org_id: string
          reply_to: string | null
          sending_domain: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          from_address: string
          from_name: string
          org_id: string
          reply_to?: string | null
          sending_domain?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          from_address?: string
          from_name?: string
          org_id?: string
          reply_to?: string | null
          sending_domain?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      email_template_defaults: {
        Row: {
          allows_attachments: boolean
          body: string
          button_label: string | null
          description: string
          key: string
          label: string
          module_key: string
          recipient_mode: string
          subject: string
          updated_at: string
          variables: Json
          view_permission: string
          why_line: string
        }
        Insert: {
          allows_attachments?: boolean
          body: string
          button_label?: string | null
          description: string
          key: string
          label: string
          module_key: string
          recipient_mode?: string
          subject: string
          updated_at?: string
          variables?: Json
          view_permission: string
          why_line: string
        }
        Update: {
          allows_attachments?: boolean
          body?: string
          button_label?: string | null
          description?: string
          key?: string
          label?: string
          module_key?: string
          recipient_mode?: string
          subject?: string
          updated_at?: string
          variables?: Json
          view_permission?: string
          why_line?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_template_defaults_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "email_template_defaults_view_permission_fkey"
            columns: ["view_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      email_template_versions: {
        Row: {
          key: string
          last_version: number
          org_id: string
        }
        Insert: {
          key: string
          last_version: number
          org_id: string
        }
        Update: {
          key?: string
          last_version?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_template_versions_key_fkey"
            columns: ["key"]
            isOneToOne: false
            referencedRelation: "email_template_defaults"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "email_template_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          button_label: string | null
          key: string
          org_id: string
          subject: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          body: string
          button_label?: string | null
          key: string
          org_id: string
          subject: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          body?: string
          button_label?: string | null
          key?: string
          org_id?: string
          subject?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_key_fkey"
            columns: ["key"]
            isOneToOne: false
            referencedRelation: "email_template_defaults"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "email_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      external_busy_blocks: {
        Row: {
          connection_id: string
          created_at: string
          ends_at: string
          id: string
          org_id: string
          professional_id: string
          starts_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          ends_at: string
          id?: string
          org_id: string
          professional_id: string
          starts_at: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          org_id?: string
          professional_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_busy_blocks_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "external_busy_blocks_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "external_busy_blocks_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "external_busy_blocks_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "external_busy_blocks_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      interac_notices: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          ignored_reason: string | null
          invoice_id: string | null
          matched_at: string | null
          matched_by: string | null
          message: string | null
          org_id: string
          payment_id: string | null
          received_on: string
          reference: string | null
          sender_name: string
          source: string
          source_ref: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          ignored_reason?: string | null
          invoice_id?: string | null
          matched_at?: string | null
          matched_by?: string | null
          message?: string | null
          org_id: string
          payment_id?: string | null
          received_on: string
          reference?: string | null
          sender_name: string
          source?: string
          source_ref?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          ignored_reason?: string | null
          invoice_id?: string | null
          matched_at?: string | null
          matched_by?: string | null
          message?: string | null
          org_id?: string
          payment_id?: string | null
          received_on?: string
          reference?: string | null
          sender_name?: string
          source?: string
          source_ref?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interac_notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "interac_notices_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "interac_notices_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "interac_notices_payment_fkey"
            columns: ["org_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          appointment_id: string | null
          client_payer_id: string | null
          created_at: string
          credited: boolean
          description: string
          gst_cents: number
          id: string
          invoice_id: string
          line_type: string
          org_id: string
          payer_organisation_id: string | null
          position: number
          price_source: string | null
          professional_id: string | null
          qst_cents: number
          quantity: number
          service_code: number | null
          service_id: string | null
          service_on: string | null
          source_line_id: string | null
          subtotal_cents: number
          tax_rule: string
          total_cents: number
          unit_price_cents: number | null
        }
        Insert: {
          appointment_id?: string | null
          client_payer_id?: string | null
          created_at?: string
          credited?: boolean
          description: string
          gst_cents?: number
          id?: string
          invoice_id: string
          line_type: string
          org_id: string
          payer_organisation_id?: string | null
          position: number
          price_source?: string | null
          professional_id?: string | null
          qst_cents?: number
          quantity?: number
          service_code?: number | null
          service_id?: string | null
          service_on?: string | null
          source_line_id?: string | null
          subtotal_cents?: number
          tax_rule?: string
          total_cents?: number
          unit_price_cents?: number | null
        }
        Update: {
          appointment_id?: string | null
          client_payer_id?: string | null
          created_at?: string
          credited?: boolean
          description?: string
          gst_cents?: number
          id?: string
          invoice_id?: string
          line_type?: string
          org_id?: string
          payer_organisation_id?: string | null
          position?: number
          price_source?: string | null
          professional_id?: string | null
          qst_cents?: number
          quantity?: number
          service_code?: number | null
          service_id?: string | null
          service_on?: string | null
          source_line_id?: string | null
          subtotal_cents?: number
          tax_rule?: string
          total_cents?: number
          unit_price_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_appointment_fkey"
            columns: ["org_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_client_payer_id_fkey"
            columns: ["client_payer_id"]
            isOneToOne: false
            referencedRelation: "client_payers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_client_payer_id_fkey"
            columns: ["client_payer_id"]
            isOneToOne: false
            referencedRelation: "client_payers_active"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_payer_organisation_fkey"
            columns: ["org_id", "payer_organisation_id"]
            isOneToOne: false
            referencedRelation: "payer_organisations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "invoice_lines_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoice_lines_source_line_id_fkey"
            columns: ["source_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_sequences: {
        Row: {
          kind: string
          last_number: number
          org_id: string
          updated_at: string
          year: number
        }
        Insert: {
          kind: string
          last_number?: number
          org_id: string
          updated_at?: string
          year: number
        }
        Update: {
          kind?: string
          last_number?: number
          org_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          credited_at: string | null
          due_on: string | null
          external_ref: string | null
          finalized_at: string | null
          finalized_by: string | null
          gst_cents: number
          gst_rate: number
          hold_note: string | null
          hold_reason: string | null
          id: string
          issued_on: string | null
          notes_client: string | null
          notes_internal: string | null
          number: string | null
          org_id: string
          paid_cents: number
          payer_client_id: string
          payer_kind: string
          payer_organisation_id: string | null
          payer_reference: string | null
          payment_status: string
          pdf_file_id: string | null
          qst_cents: number
          qst_rate: number
          queue_day: string | null
          seq: number | null
          source_id: string | null
          source_type: string
          status: string
          subtotal_cents: number
          tax_exempt: boolean
          total_cents: number
          updated_at: string
          year: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          credited_at?: string | null
          due_on?: string | null
          external_ref?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          gst_cents?: number
          gst_rate?: number
          hold_note?: string | null
          hold_reason?: string | null
          id?: string
          issued_on?: string | null
          notes_client?: string | null
          notes_internal?: string | null
          number?: string | null
          org_id: string
          paid_cents?: number
          payer_client_id: string
          payer_kind?: string
          payer_organisation_id?: string | null
          payer_reference?: string | null
          payment_status?: string
          pdf_file_id?: string | null
          qst_cents?: number
          qst_rate?: number
          queue_day?: string | null
          seq?: number | null
          source_id?: string | null
          source_type?: string
          status?: string
          subtotal_cents?: number
          tax_exempt?: boolean
          total_cents?: number
          updated_at?: string
          year?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          credited_at?: string | null
          due_on?: string | null
          external_ref?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          gst_cents?: number
          gst_rate?: number
          hold_note?: string | null
          hold_reason?: string | null
          id?: string
          issued_on?: string | null
          notes_client?: string | null
          notes_internal?: string | null
          number?: string | null
          org_id?: string
          paid_cents?: number
          payer_client_id?: string
          payer_kind?: string
          payer_organisation_id?: string | null
          payer_reference?: string | null
          payment_status?: string
          pdf_file_id?: string | null
          qst_cents?: number
          qst_rate?: number
          queue_day?: string | null
          seq?: number | null
          source_id?: string | null
          source_type?: string
          status?: string
          subtotal_cents?: number
          tax_exempt?: boolean
          total_cents?: number
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_payer_organisation_fkey"
            columns: ["org_id", "payer_organisation_id"]
            isOneToOne: false
            referencedRelation: "payer_organisations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "invoices_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
        ]
      }
      languages: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "languages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_attachments: {
        Row: {
          attempts: number
          content_id: string | null
          created_at: string
          filename: string | null
          gmail_attachment_id: string | null
          id: string
          is_inline: boolean
          message_id: string
          mime_type: string | null
          org_id: string
          part_id: string
          size_bytes: number | null
          status: string
          stored_file_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          content_id?: string | null
          created_at?: string
          filename?: string | null
          gmail_attachment_id?: string | null
          id?: string
          is_inline?: boolean
          message_id: string
          mime_type?: string | null
          org_id: string
          part_id: string
          size_bytes?: number | null
          status?: string
          stored_file_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          content_id?: string | null
          created_at?: string
          filename?: string | null
          gmail_attachment_id?: string | null
          id?: string
          is_inline?: boolean
          message_id?: string
          mime_type?: string | null
          org_id?: string
          part_id?: string
          size_bytes?: number | null
          status?: string
          stored_file_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_attachments_message_fkey"
            columns: ["org_id", "message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mail_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_attachments_stored_file_id_fkey"
            columns: ["stored_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_connection_tokens: {
        Row: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          created_at: string
          key_version: number
          org_id: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          created_at?: string
          key_version?: number
          org_id: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          connection_id?: string
          created_at?: string
          key_version?: number
          org_id?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_connection_tokens_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mail_connection_tokens_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "mail_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_connection_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_connections: {
        Row: {
          connected_at: string
          connected_by: string | null
          created_at: string
          disconnected_at: string | null
          disconnected_by: string | null
          email_address: string
          id: string
          kind: string
          org_id: string
          owner_profile_id: string | null
          scopes: string[]
          status: string
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          disconnected_by?: string | null
          email_address: string
          id?: string
          kind?: string
          org_id: string
          owner_profile_id?: string | null
          scopes?: string[]
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          disconnected_by?: string | null
          email_address?: string
          id?: string
          kind?: string
          org_id?: string
          owner_profile_id?: string | null
          scopes?: string[]
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "mail_connections_disconnected_by_fkey"
            columns: ["disconnected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "mail_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_connections_owner_fkey"
            columns: ["owner_profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      mail_drafts: {
        Row: {
          attachment_file_ids: string[]
          bcc_addresses: string[]
          body_html: string
          cc_addresses: string[]
          client_id: string | null
          connection_id: string
          created_at: string
          id: string
          mode: string
          org_id: string
          reply_to_message_id: string | null
          subject: string
          thread_id: string | null
          to_addresses: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          attachment_file_ids?: string[]
          bcc_addresses?: string[]
          body_html?: string
          cc_addresses?: string[]
          client_id?: string | null
          connection_id: string
          created_at?: string
          id?: string
          mode?: string
          org_id: string
          reply_to_message_id?: string | null
          subject?: string
          thread_id?: string | null
          to_addresses?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          attachment_file_ids?: string[]
          bcc_addresses?: string[]
          body_html?: string
          cc_addresses?: string[]
          client_id?: string | null
          connection_id?: string
          created_at?: string
          id?: string
          mode?: string
          org_id?: string
          reply_to_message_id?: string | null
          subject?: string
          thread_id?: string | null
          to_addresses?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_drafts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_drafts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_drafts_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_drafts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "mail_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_drafts_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      mail_labels: {
        Row: {
          color_background: string | null
          color_text: string | null
          connection_id: string
          created_at: string
          gmail_label_id: string
          name: string
          org_id: string
          type: string
          updated_at: string
          visibility: string | null
        }
        Insert: {
          color_background?: string | null
          color_text?: string | null
          connection_id: string
          created_at?: string
          gmail_label_id: string
          name: string
          org_id: string
          type: string
          updated_at?: string
          visibility?: string | null
        }
        Update: {
          color_background?: string | null
          color_text?: string | null
          connection_id?: string
          created_at?: string
          gmail_label_id?: string
          name?: string
          org_id?: string
          type?: string
          updated_at?: string
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_labels_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mail_labels_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_labels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_messages: {
        Row: {
          bcc_addresses: Json
          body_html: string | null
          body_purged_at: string | null
          body_text: string | null
          cc_addresses: Json
          connection_id: string
          created_at: string
          from_address: string | null
          from_name: string | null
          gmail_message_id: string
          has_attachments: boolean
          id: string
          in_reply_to: string | null
          is_inbound: boolean
          is_unread: boolean
          label_ids: string[]
          org_id: string
          reply_to_address: string | null
          rfc_message_id: string | null
          search_vector: unknown
          sent_at: string
          size_estimate: number | null
          snippet: string | null
          subject: string | null
          thread_id: string
          to_addresses: Json
          updated_at: string
        }
        Insert: {
          bcc_addresses?: Json
          body_html?: string | null
          body_purged_at?: string | null
          body_text?: string | null
          cc_addresses?: Json
          connection_id: string
          created_at?: string
          from_address?: string | null
          from_name?: string | null
          gmail_message_id: string
          has_attachments?: boolean
          id?: string
          in_reply_to?: string | null
          is_inbound?: boolean
          is_unread?: boolean
          label_ids?: string[]
          org_id: string
          reply_to_address?: string | null
          rfc_message_id?: string | null
          search_vector?: unknown
          sent_at: string
          size_estimate?: number | null
          snippet?: string | null
          subject?: string | null
          thread_id: string
          to_addresses?: Json
          updated_at?: string
        }
        Update: {
          bcc_addresses?: Json
          body_html?: string | null
          body_purged_at?: string | null
          body_text?: string | null
          cc_addresses?: Json
          connection_id?: string
          created_at?: string
          from_address?: string | null
          from_name?: string | null
          gmail_message_id?: string
          has_attachments?: boolean
          id?: string
          in_reply_to?: string | null
          is_inbound?: boolean
          is_unread?: boolean
          label_ids?: string[]
          org_id?: string
          reply_to_address?: string | null
          rfc_message_id?: string | null
          search_vector?: unknown
          sent_at?: string
          size_estimate?: number | null
          snippet?: string | null
          subject?: string | null
          thread_id?: string
          to_addresses?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_messages_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mail_messages_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_messages_thread_fkey"
            columns: ["org_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "mail_threads"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mail_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "mail_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_sends: {
        Row: {
          client_id: string | null
          connection_id: string
          created_at: string
          draft_id: string | null
          error_code: string | null
          file_ids: string[]
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          mode: string
          org_id: string
          recipient_count: number
          send_key: string
          sent_at: string | null
          sent_by: string | null
          status: string
          template_key: string | null
          thread_id: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          connection_id: string
          created_at?: string
          draft_id?: string | null
          error_code?: string | null
          file_ids?: string[]
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          mode: string
          org_id: string
          recipient_count: number
          send_key: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          template_key?: string | null
          thread_id?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          connection_id?: string
          created_at?: string
          draft_id?: string | null
          error_code?: string | null
          file_ids?: string[]
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          mode?: string
          org_id?: string
          recipient_count?: number
          send_key?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          template_key?: string | null
          thread_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_sends_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_sends_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_sends_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "mail_sends_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "mail_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_sync_state: {
        Row: {
          connection_id: string
          history_id: number | null
          initial_sync_done: boolean
          initial_sync_page_token: string | null
          last_error_at: string | null
          last_error_code: string | null
          last_sync_at: string | null
          last_sync_started_at: string | null
          last_sync_status: string | null
          lease_token: string | null
          lease_until: string | null
          messages_synced: number
          org_id: string
          sync_requested_at: string | null
          updated_at: string
          watch_expires_at: string | null
          watch_history_id: number | null
        }
        Insert: {
          connection_id: string
          history_id?: number | null
          initial_sync_done?: boolean
          initial_sync_page_token?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_sync_at?: string | null
          last_sync_started_at?: string | null
          last_sync_status?: string | null
          lease_token?: string | null
          lease_until?: string | null
          messages_synced?: number
          org_id: string
          sync_requested_at?: string | null
          updated_at?: string
          watch_expires_at?: string | null
          watch_history_id?: number | null
        }
        Update: {
          connection_id?: string
          history_id?: number | null
          initial_sync_done?: boolean
          initial_sync_page_token?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_sync_at?: string | null
          last_sync_started_at?: string | null
          last_sync_status?: string | null
          lease_token?: string | null
          lease_until?: string | null
          messages_synced?: number
          org_id?: string
          sync_requested_at?: string | null
          updated_at?: string
          watch_expires_at?: string | null
          watch_history_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_sync_state_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mail_sync_state_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "mail_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_sync_state_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_templates: {
        Row: {
          body_html: string
          created_at: string
          id: string
          name: string
          org_id: string
          owner_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          body_html: string
          created_at?: string
          id?: string
          name: string
          org_id: string
          owner_id: string
          subject?: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          owner_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_templates_owner_id_org_id_fkey"
            columns: ["owner_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      mail_thread_links: {
        Row: {
          candidate_client_ids: string[]
          client_id: string | null
          created_at: string
          linked_at: string | null
          linked_by: string | null
          org_id: string
          source: string | null
          status: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          candidate_client_ids?: string[]
          client_id?: string | null
          created_at?: string
          linked_at?: string | null
          linked_by?: string | null
          org_id: string
          source?: string | null
          status?: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          candidate_client_ids?: string[]
          client_id?: string | null
          created_at?: string
          linked_at?: string | null
          linked_by?: string | null
          org_id?: string
          source?: string | null
          status?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_thread_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "mail_thread_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_thread_links_thread_fkey"
            columns: ["org_id", "thread_id"]
            isOneToOne: false
            referencedRelation: "mail_threads"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mail_thread_links_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "mail_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_threads: {
        Row: {
          connection_id: string
          created_at: string
          first_message_at: string | null
          gmail_thread_id: string
          has_attachments: boolean
          id: string
          label_ids: string[]
          last_from_address: string | null
          last_from_name: string | null
          last_message_at: string | null
          message_count: number
          org_id: string
          snippet: string | null
          subject: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          first_message_at?: string | null
          gmail_thread_id: string
          has_attachments?: boolean
          id?: string
          label_ids?: string[]
          last_from_address?: string | null
          last_from_name?: string | null
          last_message_at?: string | null
          message_count?: number
          org_id: string
          snippet?: string | null
          subject?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          first_message_at?: string | null
          gmail_thread_id?: string
          has_attachments?: boolean
          id?: string
          label_ids?: string[]
          last_from_address?: string | null
          last_from_name?: string | null
          last_message_at?: string | null
          message_count?: number
          org_id?: string
          snippet?: string | null
          subject?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_threads_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mail_threads_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "mail_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      module_dependencies: {
        Row: {
          depends_on: string
          module_key: string
        }
        Insert: {
          depends_on: string
          module_key: string
        }
        Update: {
          depends_on?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_dependencies_depends_on_fkey"
            columns: ["depends_on"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "module_dependencies_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          key: string
          name: string
        }
        Update: {
          created_at?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      motif_categories: {
        Row: {
          created_at: string
          description: string | null
          icon: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "motif_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      motifs: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          is_active: boolean
          is_restricted: boolean
          is_system: boolean
          key: string
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_restricted?: boolean
          is_system?: boolean
          key: string
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_restricted?: boolean
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "motifs_category_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "motif_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "motifs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          notification_id: string
          org_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: string
          org_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          notification_id?: string
          org_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_reads_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          expires_at: string | null
          id: string
          importance: string
          kind: string
          link_path: string | null
          module_key: string
          org_id: string
          recipient_permission: string
          recipient_user_id: string | null
          subject_id: string | null
          subject_type: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          expires_at?: string | null
          id?: string
          importance?: string
          kind: string
          link_path?: string | null
          module_key: string
          org_id: string
          recipient_permission: string
          recipient_user_id?: string | null
          subject_id?: string | null
          subject_type?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          expires_at?: string | null
          id?: string
          importance?: string
          kind?: string
          link_path?: string | null
          module_key?: string
          org_id?: string
          recipient_permission?: string
          recipient_user_id?: string | null
          subject_id?: string | null
          subject_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_permission_fkey"
            columns: ["recipient_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_org_id_fkey"
            columns: ["recipient_user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      org_module_settings: {
        Row: {
          module_key: string
          org_id: string
          settings: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          module_key: string
          org_id: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          module_key?: string
          org_id?: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_module_settings_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "org_module_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_module_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      org_module_testers: {
        Row: {
          created_at: string
          created_by: string | null
          module_key: string
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          module_key: string
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          module_key?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_module_testers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_module_testers_module_fkey"
            columns: ["org_id", "module_key"]
            isOneToOne: false
            referencedRelation: "org_modules"
            referencedColumns: ["org_id", "module_key"]
          },
          {
            foreignKeyName: "org_module_testers_user_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      org_modules: {
        Row: {
          disabled_at: string | null
          enabled: boolean
          module_key: string
          org_id: string
          testers_only: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          disabled_at?: string | null
          enabled?: boolean
          module_key: string
          org_id: string
          testers_only?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          disabled_at?: string | null
          enabled?: boolean
          module_key?: string
          org_id?: string
          testers_only?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_modules_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "org_modules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_modules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      org_role_permissions: {
        Row: {
          org_id: string
          permission_key: string
          role: string
        }
        Insert: {
          org_id: string
          permission_key: string
          role: string
        }
        Update: {
          org_id?: string
          permission_key?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_role_permissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "org_role_permissions_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      org_scheduled_jobs: {
        Row: {
          enabled: boolean
          job_key: string
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled: boolean
          job_key: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          job_key?: string
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_scheduled_jobs_job_key_fkey"
            columns: ["job_key"]
            isOneToOne: false
            referencedRelation: "scheduled_jobs"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "org_scheduled_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_scheduled_jobs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      org_secrets: {
        Row: {
          key: string
          org_id: string
          updated_at: string
          updated_by: string | null
          vault_secret_id: string
          version: number
        }
        Insert: {
          key: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
          vault_secret_id: string
          version?: number
        }
        Update: {
          key?: string
          org_id?: string
          updated_at?: string
          updated_by?: string | null
          vault_secret_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_secrets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_secrets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      organization_bank_details: {
        Row: {
          account_last4: string
          account_number: string
          etransfer_email: string | null
          institution_number: string
          key_version: number
          org_id: string
          transit_number: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_last4: string
          account_number: string
          etransfer_email?: string | null
          institution_number: string
          key_version?: number
          org_id: string
          transit_number: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_last4?: string
          account_number?: string
          etransfer_email?: string | null
          institution_number?: string
          key_version?: number
          org_id?: string
          transit_number?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_bank_details_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_bank_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      organizations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string
          created_at: string
          currency: string
          default_locale: string
          email: string | null
          gst_number: string | null
          id: string
          legal_name: string | null
          logo_file_id: string | null
          name: string
          neq: string | null
          phone: string | null
          postal_code: string | null
          privacy_officer_email: string | null
          privacy_officer_name: string | null
          privacy_policy_url: string | null
          province: string | null
          qst_number: string | null
          record_retention_years: number | null
          signatory_email: string | null
          signatory_name: string | null
          signatory_title: string | null
          signature_file_id: string | null
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string
          created_at?: string
          currency?: string
          default_locale?: string
          email?: string | null
          gst_number?: string | null
          id?: string
          legal_name?: string | null
          logo_file_id?: string | null
          name: string
          neq?: string | null
          phone?: string | null
          postal_code?: string | null
          privacy_officer_email?: string | null
          privacy_officer_name?: string | null
          privacy_policy_url?: string | null
          province?: string | null
          qst_number?: string | null
          record_retention_years?: number | null
          signatory_email?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          signature_file_id?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string
          created_at?: string
          currency?: string
          default_locale?: string
          email?: string | null
          gst_number?: string | null
          id?: string
          legal_name?: string | null
          logo_file_id?: string | null
          name?: string
          neq?: string | null
          phone?: string | null
          postal_code?: string | null
          privacy_officer_email?: string | null
          privacy_officer_name?: string | null
          privacy_policy_url?: string | null
          province?: string | null
          qst_number?: string | null
          record_retention_years?: number | null
          signatory_email?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          signature_file_id?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_logo_file_id_fkey"
            columns: ["logo_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_signature_file_id_fkey"
            columns: ["signature_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
        ]
      }
      payer_organisations: {
        Row: {
          billing_email: string | null
          cadence: string
          contact_name: string | null
          created_at: string
          created_by: string | null
          due_days: number
          id: string
          is_active: boolean
          kind: string
          language: string
          name: string
          note: string | null
          org_id: string
          provider_number: string | null
          reminders_enabled: boolean
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          cadence: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          due_days?: number
          id?: string
          is_active?: boolean
          kind: string
          language?: string
          name: string
          note?: string | null
          org_id: string
          provider_number?: string | null
          reminders_enabled?: boolean
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          cadence?: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          due_days?: number
          id?: string
          is_active?: boolean
          kind?: string
          language?: string
          name?: string
          note?: string | null
          org_id?: string
          provider_number?: string | null
          reminders_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payer_organisations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payer_organisations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_modes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_deposit: boolean
          name: string
          org_id: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_deposit?: boolean
          name: string
          org_id: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_deposit?: boolean
          name?: string
          org_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_modes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          external_ref: string | null
          id: string
          invoice_id: string
          mode_code: string
          note: string | null
          org_id: string
          paid_on: string
          payer_client_id: string
          reference: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          external_ref?: string | null
          id?: string
          invoice_id: string
          mode_code: string
          note?: string | null
          org_id: string
          paid_on: string
          payer_client_id: string
          reference?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          external_ref?: string | null
          id?: string
          invoice_id?: string
          mode_code?: string
          note?: string | null
          org_id?: string
          paid_on?: string
          payer_client_id?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payments_mode_fkey"
            columns: ["org_id", "mode_code"]
            isOneToOne: false
            referencedRelation: "payment_modes"
            referencedColumns: ["org_id", "code"]
          },
          {
            foreignKeyName: "payments_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payments_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      payout_lines: {
        Row: {
          amount_cents: number | null
          appointment_id: string | null
          base_cents: number | null
          client_id: string | null
          created_at: string
          created_by: string | null
          duration: number | null
          id: string
          invoice_line_id: string | null
          kind: string
          note: string | null
          occurred_on: string
          org_id: string
          paid_on: string | null
          period_id: string
          pricing: string
          retention_pct: number | null
          service_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          appointment_id?: string | null
          base_cents?: number | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          duration?: number | null
          id?: string
          invoice_line_id?: string | null
          kind: string
          note?: string | null
          occurred_on: string
          org_id: string
          paid_on?: string | null
          period_id: string
          pricing: string
          retention_pct?: number | null
          service_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          appointment_id?: string | null
          base_cents?: number | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          duration?: number | null
          id?: string
          invoice_line_id?: string | null
          kind?: string
          note?: string | null
          occurred_on?: string
          org_id?: string
          paid_on?: string | null
          period_id?: string
          pricing?: string
          retention_pct?: number | null
          service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_lines_appointment_fkey"
            columns: ["org_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_lines_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_lines_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payout_lines_invoice_line_fkey"
            columns: ["invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_lines_period_fkey"
            columns: ["org_id", "period_id"]
            isOneToOne: false
            referencedRelation: "payout_periods"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_lines_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_lines_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      payout_periods: {
        Row: {
          built_at: string
          built_by: string | null
          correction_note: string | null
          correction_requested_at: string | null
          created_at: string
          id: string
          lines_count: number
          month: string
          org_id: string
          paid_at: string | null
          paid_by: string | null
          paid_on: string | null
          payment_note: string | null
          professional_id: string
          reopen_reason: string | null
          sent_at: string | null
          sent_by: string | null
          state: string
          title_name: string | null
          total_cents: number
          unpriced_count: number
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          built_at?: string
          built_by?: string | null
          correction_note?: string | null
          correction_requested_at?: string | null
          created_at?: string
          id?: string
          lines_count?: number
          month: string
          org_id: string
          paid_at?: string | null
          paid_by?: string | null
          paid_on?: string | null
          payment_note?: string | null
          professional_id: string
          reopen_reason?: string | null
          sent_at?: string | null
          sent_by?: string | null
          state?: string
          title_name?: string | null
          total_cents?: number
          unpriced_count?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          built_at?: string
          built_by?: string | null
          correction_note?: string | null
          correction_requested_at?: string | null
          created_at?: string
          id?: string
          lines_count?: number
          month?: string
          org_id?: string
          paid_at?: string | null
          paid_by?: string | null
          paid_on?: string | null
          payment_note?: string | null
          professional_id?: string
          reopen_reason?: string | null
          sent_at?: string | null
          sent_by?: string | null
          state?: string
          title_name?: string | null
          total_cents?: number
          unpriced_count?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_periods_built_by_fkey"
            columns: ["built_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payout_periods_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payout_periods_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_periods_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_periods_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_periods_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "payout_periods_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payout_periods_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payout_service_rules: {
        Row: {
          org_id: string
          rule: string
          service_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          org_id: string
          rule: string
          service_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          org_id?: string
          rule?: string
          service_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_service_rules_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: true
            referencedRelation: "services"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_service_rules_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: true
            referencedRelation: "services_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "payout_service_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string
          key: string
          module_key: string
        }
        Insert: {
          description: string
          key: string
          module_key: string
        }
        Update: {
          description?: string
          key?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "permissions_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      profession_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profession_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profession_titles: {
        Row: {
          category_id: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          name: string
          name_feminine: string | null
          name_masculine: string | null
          order_id: string | null
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          name: string
          name_feminine?: string | null
          name_masculine?: string | null
          order_id?: string | null
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          name?: string
          name_feminine?: string | null
          name_masculine?: string | null
          order_id?: string | null
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profession_titles_category_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "profession_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "profession_titles_order_fkey"
            columns: ["org_id", "order_id"]
            isOneToOne: false
            referencedRelation: "professional_orders"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "profession_titles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_client_agreements: {
        Row: {
          client_id: string | null
          client_label: string
          client_price_cents: number
          created_at: string
          created_by: string | null
          duration: number
          effective_from: string
          effective_to: string | null
          id: string
          note: string | null
          org_id: string
          professional_amount_cents: number
          professional_id: string
        }
        Insert: {
          client_id?: string | null
          client_label: string
          client_price_cents: number
          created_at?: string
          created_by?: string | null
          duration: number
          effective_from: string
          effective_to?: string | null
          id?: string
          note?: string | null
          org_id: string
          professional_amount_cents: number
          professional_id: string
        }
        Update: {
          client_id?: string | null
          client_label?: string
          client_price_cents?: number
          created_at?: string
          created_by?: string | null
          duration?: number
          effective_from?: string
          effective_to?: string | null
          id?: string
          note?: string | null
          org_id?: string
          professional_amount_cents?: number
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_client_agreements_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_client_agreements_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_client_agreements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_client_agreements_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_client_agreements_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_client_agreements_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_client_agreements_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_clienteles: {
        Row: {
          clientele_id: string
          created_at: string
          is_specialized: boolean
          org_id: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          clientele_id: string
          created_at?: string
          is_specialized?: boolean
          org_id: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          clientele_id?: string
          created_at?: string
          is_specialized?: boolean
          org_id?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_clienteles_clientele_fkey"
            columns: ["org_id", "clientele_id"]
            isOneToOne: false
            referencedRelation: "clienteles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_clienteles_clientele_fkey"
            columns: ["org_id", "clientele_id"]
            isOneToOne: false
            referencedRelation: "clienteles_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_clienteles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_clienteles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_clienteles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_clienteles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_consents: {
        Row: {
          consent_version_id: string
          created_at: string
          expires_on: string
          id: string
          org_id: string
          professional_id: string
          signed_at: string
          signer_name: string
          submission_id: string | null
          withdrawal_effective_on: string | null
          withdrawn_at: string | null
        }
        Insert: {
          consent_version_id: string
          created_at?: string
          expires_on: string
          id?: string
          org_id: string
          professional_id: string
          signed_at: string
          signer_name: string
          submission_id?: string | null
          withdrawal_effective_on?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          consent_version_id?: string
          created_at?: string
          expires_on?: string
          id?: string
          org_id?: string
          professional_id?: string
          signed_at?: string
          signer_name?: string
          submission_id?: string | null
          withdrawal_effective_on?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_consents_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_consents_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_consents_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_consents_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_consents_submission_fkey"
            columns: ["professional_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "professional_submissions"
            referencedColumns: ["professional_id", "id"]
          },
          {
            foreignKeyName: "professional_consents_version_fkey"
            columns: ["org_id", "consent_version_id"]
            isOneToOne: false
            referencedRelation: "consent_versions"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      professional_contract_snapshots: {
        Row: {
          annexe: Json
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          org_id: string
          professional_id: string
          signers: Json
          template_values: Json
          template_version_id: string
          title: string
        }
        Insert: {
          annexe: Json
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          org_id: string
          professional_id: string
          signers: Json
          template_values: Json
          template_version_id: string
          title: string
        }
        Update: {
          annexe?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          org_id?: string
          professional_id?: string
          signers?: Json
          template_values?: Json
          template_version_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_contract_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_contract_snapshots_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_contract_snapshots_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_contract_snapshots_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_contract_snapshots_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_contract_snapshots_version_fkey"
            columns: ["template_version_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      professional_documents: {
        Row: {
          created_at: string
          document_type_id: string
          expires_on: string | null
          id: string
          metadata: Json
          org_id: string
          professional_id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          signature_request_id: string | null
          status: string
          stored_file_id: string
          submission_id: string | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          withdrawal_note: string | null
          withdrawn_at: string | null
          withdrawn_by: string | null
          withdrawn_on: string | null
        }
        Insert: {
          created_at?: string
          document_type_id: string
          expires_on?: string | null
          id?: string
          metadata?: Json
          org_id: string
          professional_id: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          signature_request_id?: string | null
          status?: string
          stored_file_id: string
          submission_id?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          withdrawal_note?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
          withdrawn_on?: string | null
        }
        Update: {
          created_at?: string
          document_type_id?: string
          expires_on?: string | null
          id?: string
          metadata?: Json
          org_id?: string
          professional_id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          signature_request_id?: string | null
          status?: string
          stored_file_id?: string
          submission_id?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          withdrawal_note?: string | null
          withdrawn_at?: string | null
          withdrawn_by?: string | null
          withdrawn_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_documents_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_documents_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_documents_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_documents_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_documents_signature_request_fkey"
            columns: ["signature_request_id"]
            isOneToOne: true
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_documents_stored_file_fkey"
            columns: ["stored_file_id"]
            isOneToOne: true
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_documents_submission_fkey"
            columns: ["professional_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "professional_submissions"
            referencedColumns: ["professional_id", "id"]
          },
          {
            foreignKeyName: "professional_documents_type_fkey"
            columns: ["org_id", "document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_documents_withdrawn_by_fkey"
            columns: ["withdrawn_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_invitation_deliveries: {
        Row: {
          created_at: string
          created_by: string | null
          email_failure: string | null
          id: string
          link_id: string
          method: string
          org_id: string
          professional_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email_failure?: string | null
          id?: string
          link_id: string
          method: string
          org_id: string
          professional_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email_failure?: string | null
          id?: string
          link_id?: string
          method?: string
          org_id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_invitation_deliveries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_invitation_deliveries_link_fkey"
            columns: ["link_id"]
            isOneToOne: true
            referencedRelation: "secure_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_invitation_deliveries_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_invitation_deliveries_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_invitation_deliveries_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_invitation_deliveries_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_invoices: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          exported_at: string | null
          file_id: string
          id: string
          issued_on: string
          number: string
          org_id: string
          period_id: string
          qbo_bill_id: string | null
          source: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          exported_at?: string | null
          file_id: string
          id?: string
          issued_on: string
          number: string
          org_id: string
          period_id: string
          qbo_bill_id?: string | null
          source: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          exported_at?: string | null
          file_id?: string
          id?: string
          issued_on?: string
          number?: string
          org_id?: string
          period_id?: string
          qbo_bill_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_invoices_file_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_invoices_period_fkey"
            columns: ["org_id", "period_id"]
            isOneToOne: false
            referencedRelation: "payout_periods"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      professional_languages: {
        Row: {
          created_at: string
          language_id: string
          org_id: string
          professional_id: string
        }
        Insert: {
          created_at?: string
          language_id: string
          org_id: string
          professional_id: string
        }
        Update: {
          created_at?: string
          language_id?: string
          org_id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_languages_language_fkey"
            columns: ["org_id", "language_id"]
            isOneToOne: false
            referencedRelation: "languages"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_languages_language_fkey"
            columns: ["org_id", "language_id"]
            isOneToOne: false
            referencedRelation: "languages_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_languages_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_languages_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_languages_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_languages_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_matching_notes: {
        Row: {
          created_at: string
          note: string
          org_id: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          note: string
          org_id: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          note?: string
          org_id?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_matching_notes_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_notes_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_notes_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_notes_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_matching_priorities: {
        Row: {
          created_at: string
          org_id: string
          professional_id: string
          reason: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          org_id: string
          professional_id: string
          reason: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          org_id?: string
          professional_id?: string
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_matching_priorities_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_priorities_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_priorities_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_priorities_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_matching_profiles: {
        Row: {
          accepting_new_clients: boolean
          availability_note: string | null
          availability_periods: string[]
          created_at: string
          min_client_age: number | null
          new_client_places: number | null
          new_client_places_set_at: string | null
          org_id: string
          professional_id: string
          updated_at: string
          women_only: boolean
        }
        Insert: {
          accepting_new_clients?: boolean
          availability_note?: string | null
          availability_periods?: string[]
          created_at?: string
          min_client_age?: number | null
          new_client_places?: number | null
          new_client_places_set_at?: string | null
          org_id: string
          professional_id: string
          updated_at?: string
          women_only?: boolean
        }
        Update: {
          accepting_new_clients?: boolean
          availability_note?: string | null
          availability_periods?: string[]
          created_at?: string
          min_client_age?: number | null
          new_client_places?: number | null
          new_client_places_set_at?: string | null
          org_id?: string
          professional_id?: string
          updated_at?: string
          women_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "professional_matching_profiles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_profiles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_profiles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_matching_profiles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_motifs: {
        Row: {
          created_at: string
          motif_id: string
          org_id: string
          professional_id: string
        }
        Insert: {
          created_at?: string
          motif_id: string
          org_id: string
          professional_id: string
        }
        Update: {
          created_at?: string
          motif_id?: string
          org_id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_motifs_motif_fkey"
            columns: ["org_id", "motif_id"]
            isOneToOne: false
            referencedRelation: "motifs"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_motifs_motif_fkey"
            columns: ["org_id", "motif_id"]
            isOneToOne: false
            referencedRelation: "motifs_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_motifs_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_motifs_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_motifs_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_motifs_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_orders: {
        Row: {
          acronym: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          licence_label: string
          licence_pattern: string | null
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          acronym: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          licence_label?: string
          licence_pattern?: string | null
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          acronym?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          licence_label?: string
          licence_pattern?: string | null
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_paper_contracts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          professional_id: string
          signed_on: string
          stored_file_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          professional_id: string
          signed_on: string
          stored_file_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          professional_id?: string
          signed_on?: string
          stored_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_paper_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_paper_contracts_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_paper_contracts_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_paper_contracts_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_paper_contracts_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_paper_contracts_stored_file_id_fkey"
            columns: ["stored_file_id"]
            isOneToOne: true
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_payer_numbers: {
        Row: {
          created_at: string
          number: string
          org_id: string
          payer_type: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          number: string
          org_id: string
          payer_type: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          number?: string
          org_id?: string
          payer_type?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_payer_numbers_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_payer_numbers_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_payer_numbers_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_payer_numbers_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_private: {
        Row: {
          bank_account: string | null
          bank_account_last4: string | null
          bank_institution: string | null
          bank_transit: string | null
          business_number: string | null
          created_at: string
          gst_number: string | null
          key_version: number
          org_id: string
          professional_id: string
          qst_number: string | null
          sin: string | null
          sin_last3: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_account_last4?: string | null
          bank_institution?: string | null
          bank_transit?: string | null
          business_number?: string | null
          created_at?: string
          gst_number?: string | null
          key_version?: number
          org_id: string
          professional_id: string
          qst_number?: string | null
          sin?: string | null
          sin_last3?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_account_last4?: string | null
          bank_institution?: string | null
          bank_transit?: string | null
          business_number?: string | null
          created_at?: string
          gst_number?: string | null
          key_version?: number
          org_id?: string
          professional_id?: string
          qst_number?: string | null
          sin?: string | null
          sin_last3?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_private_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_private_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_private_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_private_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_private_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_professions: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          licence_number: string | null
          org_id: string
          profession_title_id: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          licence_number?: string | null
          org_id: string
          profession_title_id: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          licence_number?: string | null
          org_id?: string
          profession_title_id?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_professions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_professions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_professions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_professions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_professions_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_professions_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      professional_public_profiles: {
        Row: {
          approach: string | null
          bio: string | null
          created_at: string
          org_id: string
          photo_document_id: string | null
          professional_id: string
          public_email: string | null
          public_phone: string | null
          updated_at: string
        }
        Insert: {
          approach?: string | null
          bio?: string | null
          created_at?: string
          org_id: string
          photo_document_id?: string | null
          professional_id: string
          public_email?: string | null
          public_phone?: string | null
          updated_at?: string
        }
        Update: {
          approach?: string | null
          bio?: string | null
          created_at?: string
          org_id?: string
          photo_document_id?: string | null
          professional_id?: string
          public_email?: string | null
          public_phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_public_profiles_photo_fkey"
            columns: ["professional_id", "photo_document_id"]
            isOneToOne: false
            referencedRelation: "professional_documents"
            referencedColumns: ["professional_id", "id"]
          },
          {
            foreignKeyName: "professional_public_profiles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_public_profiles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_public_profiles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_public_profiles_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_refused_motifs: {
        Row: {
          created_at: string
          motif_id: string
          org_id: string
          professional_id: string
        }
        Insert: {
          created_at?: string
          motif_id: string
          org_id: string
          professional_id: string
        }
        Update: {
          created_at?: string
          motif_id?: string
          org_id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_refused_motifs_motif_fkey"
            columns: ["org_id", "motif_id"]
            isOneToOne: false
            referencedRelation: "motifs"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_refused_motifs_motif_fkey"
            columns: ["org_id", "motif_id"]
            isOneToOne: false
            referencedRelation: "motifs_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_refused_motifs_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_refused_motifs_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_refused_motifs_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_refused_motifs_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_retention: {
        Row: {
          created_at: string
          created_by: string | null
          decision: string
          effective_from: string
          effective_to: string | null
          id: string
          note: string | null
          org_id: string
          professional_id: string
          retention_pct: number
          sessions_total: number | null
          suggested_pct: number | null
          tier_threshold: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decision: string
          effective_from: string
          effective_to?: string | null
          id?: string
          note?: string | null
          org_id: string
          professional_id: string
          retention_pct: number
          sessions_total?: number | null
          suggested_pct?: number | null
          tier_threshold?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decision?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          note?: string | null
          org_id?: string
          professional_id?: string
          retention_pct?: number
          sessions_total?: number | null
          suggested_pct?: number | null
          tier_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_retention_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_retention_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_retention_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_retention_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_retention_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      professional_session_counts: {
        Row: {
          adjustment: number
          created_at: string
          created_by: string | null
          id: string
          month: string
          note: string | null
          org_id: string
          professional_id: string
          sessions_30: number
          sessions_50_60: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          adjustment?: number
          created_at?: string
          created_by?: string | null
          id?: string
          month: string
          note?: string | null
          org_id: string
          professional_id: string
          sessions_30?: number
          sessions_50_60?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          adjustment?: number
          created_at?: string
          created_by?: string | null
          id?: string
          month?: string
          note?: string | null
          org_id?: string
          professional_id?: string
          sessions_30?: number
          sessions_50_60?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_session_counts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_session_counts_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_session_counts_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_session_counts_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_session_counts_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_session_counts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professional_submission_private: {
        Row: {
          bank_account: string | null
          bank_account_last4: string | null
          bank_institution: string | null
          bank_transit: string | null
          business_number: string | null
          created_at: string
          gst_number: string | null
          key_version: number
          org_id: string
          professional_id: string
          qst_number: string | null
          sin: string | null
          sin_last3: string | null
          submission_id: string
          updated_at: string
        }
        Insert: {
          bank_account?: string | null
          bank_account_last4?: string | null
          bank_institution?: string | null
          bank_transit?: string | null
          business_number?: string | null
          created_at?: string
          gst_number?: string | null
          key_version?: number
          org_id: string
          professional_id: string
          qst_number?: string | null
          sin?: string | null
          sin_last3?: string | null
          submission_id: string
          updated_at?: string
        }
        Update: {
          bank_account?: string | null
          bank_account_last4?: string | null
          bank_institution?: string | null
          bank_transit?: string | null
          business_number?: string | null
          created_at?: string
          gst_number?: string | null
          key_version?: number
          org_id?: string
          professional_id?: string
          qst_number?: string | null
          sin?: string | null
          sin_last3?: string | null
          submission_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_submission_private_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_submission_private_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_submission_private_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_submission_private_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_submission_private_submission_fkey"
            columns: ["professional_id", "submission_id"]
            isOneToOne: false
            referencedRelation: "professional_submissions"
            referencedColumns: ["professional_id", "id"]
          },
        ]
      }
      professional_submissions: {
        Row: {
          applied_fields: string[] | null
          created_at: string
          decision_note: string | null
          id: string
          kind: string
          org_id: string
          prefill: Json
          private_saved_at: string | null
          professional_id: string
          requested_by: string | null
          requested_sections: string[]
          reviewed_at: string | null
          reviewed_by: string | null
          secure_link_id: string | null
          status: string
          submitted_at: string | null
          submitted_values: Json
          updated_at: string
        }
        Insert: {
          applied_fields?: string[] | null
          created_at?: string
          decision_note?: string | null
          id?: string
          kind: string
          org_id: string
          prefill?: Json
          private_saved_at?: string | null
          professional_id: string
          requested_by?: string | null
          requested_sections: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          secure_link_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_values?: Json
          updated_at?: string
        }
        Update: {
          applied_fields?: string[] | null
          created_at?: string
          decision_note?: string | null
          id?: string
          kind?: string
          org_id?: string
          prefill?: Json
          private_saved_at?: string | null
          professional_id?: string
          requested_by?: string | null
          requested_sections?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          secure_link_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_values?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_submissions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_submissions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_submissions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_submissions_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_submissions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professional_submissions_secure_link_fkey"
            columns: ["secure_link_id"]
            isOneToOne: false
            referencedRelation: "secure_links"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_video_links: {
        Row: {
          created_at: string
          org_id: string
          professional_id: string
          updated_at: string
          updated_by: string | null
          url: string
        }
        Insert: {
          created_at?: string
          org_id: string
          professional_id: string
          updated_at?: string
          updated_by?: string | null
          url: string
        }
        Update: {
          created_at?: string
          org_id?: string
          professional_id?: string
          updated_at?: string
          updated_by?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_video_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_video_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_video_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professional_video_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "professional_video_links_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      professionals: {
        Row: {
          activation_override_reason: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string
          created_at: string
          created_by: string | null
          deactivation_disabled_account: boolean
          deactivation_note: string | null
          deactivation_reason_id: string | null
          email: string
          fiche_generated_at: string | null
          first_name: string
          gender: string | null
          id: string
          last_name: string
          org_id: string
          personal_phone: string | null
          postal_code: string | null
          profile_id: string | null
          province: string
          status: string
          status_changed_at: string
          status_changed_by: string | null
          supervisor_professional_id: string | null
          updated_at: string
          years_experience: number | null
        }
        Insert: {
          activation_override_reason?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          deactivation_disabled_account?: boolean
          deactivation_note?: string | null
          deactivation_reason_id?: string | null
          email: string
          fiche_generated_at?: string | null
          first_name: string
          gender?: string | null
          id?: string
          last_name: string
          org_id: string
          personal_phone?: string | null
          postal_code?: string | null
          profile_id?: string | null
          province?: string
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          supervisor_professional_id?: string | null
          updated_at?: string
          years_experience?: number | null
        }
        Update: {
          activation_override_reason?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          deactivation_disabled_account?: boolean
          deactivation_note?: string | null
          deactivation_reason_id?: string | null
          email?: string
          fiche_generated_at?: string | null
          first_name?: string
          gender?: string | null
          id?: string
          last_name?: string
          org_id?: string
          personal_phone?: string | null
          postal_code?: string | null
          profile_id?: string | null
          province?: string
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
          supervisor_professional_id?: string | null
          updated_at?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professionals_deactivation_reason_fkey"
            columns: ["org_id", "deactivation_reason_id"]
            isOneToOne: false
            referencedRelation: "deactivation_reasons"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professionals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professionals_profile_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
          {
            foreignKeyName: "professionals_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "professionals_supervisor_fkey"
            columns: ["org_id", "supervisor_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professionals_supervisor_fkey"
            columns: ["org_id", "supervisor_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professionals_supervisor_fkey"
            columns: ["org_id", "supervisor_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professionals_supervisor_fkey"
            columns: ["org_id", "supervisor_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          email: string
          org_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email: string
          org_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          org_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_account_map: {
        Row: {
          created_at: string
          id: string
          map_key: string
          org_id: string
          profession_title_id: string | null
          qbo_account_id: string | null
          suggested: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          map_key: string
          org_id: string
          profession_title_id?: string | null
          qbo_account_id?: string | null
          suggested?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          map_key?: string
          org_id?: string
          profession_title_id?: string | null
          qbo_account_id?: string | null
          suggested?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_account_map_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_account_map_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_account_map_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_account_map_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      qbo_accounts: {
        Row: {
          account_sub_type: string | null
          account_type: string
          acct_num: string | null
          active: boolean
          classification: string | null
          connection_id: string
          fully_qualified_name: string | null
          name: string
          org_id: string
          qbo_id: string
          synced_at: string
        }
        Insert: {
          account_sub_type?: string | null
          account_type: string
          acct_num?: string | null
          active?: boolean
          classification?: string | null
          connection_id: string
          fully_qualified_name?: string | null
          name: string
          org_id: string
          qbo_id: string
          synced_at?: string
        }
        Update: {
          account_sub_type?: string | null
          account_type?: string
          acct_num?: string | null
          active?: boolean
          classification?: string | null
          connection_id?: string
          fully_qualified_name?: string | null
          name?: string
          org_id?: string
          qbo_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_accounts_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_connection_tokens: {
        Row: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          created_at: string
          key_version: number
          org_id: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          created_at?: string
          key_version?: number
          org_id: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          connection_id?: string
          created_at?: string
          key_version?: number
          org_id?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_connection_tokens_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_connection_tokens_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "qbo_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_connection_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_connections: {
        Row: {
          accounts_synced_at: string | null
          company_name: string | null
          connected_at: string
          connected_by: string | null
          created_at: string
          customers_synced_at: string | null
          disconnected_at: string | null
          disconnected_by: string | null
          environment: string
          id: string
          last_error_at: string | null
          last_error_code: string | null
          last_sync_at: string | null
          last_sync_status: string | null
          org_id: string
          realm_id: string
          refresh_token_expires_at: string | null
          status: string
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          accounts_synced_at?: string | null
          company_name?: string | null
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          customers_synced_at?: string | null
          disconnected_at?: string | null
          disconnected_by?: string | null
          environment?: string
          id?: string
          last_error_at?: string | null
          last_error_code?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          org_id: string
          realm_id: string
          refresh_token_expires_at?: string | null
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          accounts_synced_at?: string | null
          company_name?: string | null
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          customers_synced_at?: string | null
          disconnected_at?: string | null
          disconnected_by?: string | null
          environment?: string
          id?: string
          last_error_at?: string | null
          last_error_code?: string | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          org_id?: string
          realm_id?: string
          refresh_token_expires_at?: string | null
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "qbo_connections_disconnected_by_fkey"
            columns: ["disconnected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "qbo_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_customer_matches: {
        Row: {
          candidate_client_ids: string[]
          client_id: string | null
          connection_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          level: string
          match_input_hash: string
          org_id: string
          qbo_id: string
          reasons: string[]
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          candidate_client_ids?: string[]
          client_id?: string | null
          connection_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          level: string
          match_input_hash: string
          org_id: string
          qbo_id: string
          reasons?: string[]
          source?: string
          status: string
          updated_at?: string
        }
        Update: {
          candidate_client_ids?: string[]
          client_id?: string | null
          connection_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          level?: string
          match_input_hash?: string
          org_id?: string
          qbo_id?: string
          reasons?: string[]
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_customer_matches_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_customer_matches_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_customer_matches_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_customer_matches_customer_fkey"
            columns: ["connection_id", "qbo_id"]
            isOneToOne: true
            referencedRelation: "qbo_customers"
            referencedColumns: ["connection_id", "qbo_id"]
          },
          {
            foreignKeyName: "qbo_customer_matches_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "qbo_customer_matches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_customers: {
        Row: {
          active: boolean
          company_name: string | null
          connection_id: string
          display_name: string
          email: string | null
          family_name: string | null
          given_name: string | null
          is_job: boolean
          match_input_hash: string
          org_id: string
          parent_qbo_id: string | null
          phones: string[]
          qbo_id: string
          synced_at: string
        }
        Insert: {
          active?: boolean
          company_name?: string | null
          connection_id: string
          display_name: string
          email?: string | null
          family_name?: string | null
          given_name?: string | null
          is_job?: boolean
          match_input_hash: string
          org_id: string
          parent_qbo_id?: string | null
          phones?: string[]
          qbo_id: string
          synced_at?: string
        }
        Update: {
          active?: boolean
          company_name?: string | null
          connection_id?: string
          display_name?: string
          email?: string | null
          family_name?: string | null
          given_name?: string | null
          is_job?: boolean
          match_input_hash?: string
          org_id?: string
          parent_qbo_id?: string | null
          phones?: string[]
          qbo_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_customers_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_items: {
        Row: {
          active: boolean
          connection_id: string
          income_account_id: string | null
          item_type: string | null
          name: string
          org_id: string
          qbo_id: string
          sku: string | null
          synced_at: string
        }
        Insert: {
          active?: boolean
          connection_id: string
          income_account_id?: string | null
          item_type?: string | null
          name: string
          org_id: string
          qbo_id: string
          sku?: string | null
          synced_at?: string
        }
        Update: {
          active?: boolean
          connection_id?: string
          income_account_id?: string | null
          item_type?: string | null
          name?: string
          org_id?: string
          qbo_id?: string
          sku?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_items_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_links: {
        Row: {
          client_id: string | null
          connection_id: string
          created_at: string
          id: string
          kind: string
          org_id: string
          payer_client_id: string
          qbo_customer_id: string
          source: string
        }
        Insert: {
          client_id?: string | null
          connection_id: string
          created_at?: string
          id?: string
          kind: string
          org_id: string
          payer_client_id: string
          qbo_customer_id: string
          source: string
        }
        Update: {
          client_id?: string | null
          connection_id?: string
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          payer_client_id?: string
          qbo_customer_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_links_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_links_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_links_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_links_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_links_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      qbo_organisation_links: {
        Row: {
          client_id: string | null
          connection_id: string
          created_at: string
          id: string
          kind: string
          org_id: string
          payer_organisation_id: string
          qbo_customer_id: string
          source: string
        }
        Insert: {
          client_id?: string | null
          connection_id: string
          created_at?: string
          id?: string
          kind: string
          org_id: string
          payer_organisation_id: string
          qbo_customer_id: string
          source: string
        }
        Update: {
          client_id?: string | null
          connection_id?: string
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          payer_organisation_id?: string
          qbo_customer_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_organisation_links_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_organisation_links_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_organisation_links_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_organisation_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_organisation_links_organisation_fkey"
            columns: ["org_id", "payer_organisation_id"]
            isOneToOne: false
            referencedRelation: "payer_organisations"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      qbo_pushes: {
        Row: {
          amount_mismatch: boolean
          attempts: number
          created_at: string
          entity_id: string
          event_id: number | null
          id: string
          invoice_id: string | null
          kind: string
          last_error_code: string | null
          next_attempt_at: string
          org_id: string
          pushed_at: string | null
          qbo_customer_id: string | null
          qbo_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_mismatch?: boolean
          attempts?: number
          created_at?: string
          entity_id: string
          event_id?: number | null
          id?: string
          invoice_id?: string | null
          kind: string
          last_error_code?: string | null
          next_attempt_at?: string
          org_id: string
          pushed_at?: string | null
          qbo_customer_id?: string | null
          qbo_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_mismatch?: boolean
          attempts?: number
          created_at?: string
          entity_id?: string
          event_id?: number | null
          id?: string
          invoice_id?: string | null
          kind?: string
          last_error_code?: string | null
          next_attempt_at?: string
          org_id?: string
          pushed_at?: string | null
          qbo_customer_id?: string | null
          qbo_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_pushes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_tax_codes: {
        Row: {
          active: boolean
          connection_id: string
          name: string
          org_id: string
          qbo_id: string
          synced_at: string
          taxable: boolean | null
        }
        Insert: {
          active?: boolean
          connection_id: string
          name: string
          org_id: string
          qbo_id: string
          synced_at?: string
          taxable?: boolean | null
        }
        Update: {
          active?: boolean
          connection_id?: string
          name?: string
          org_id?: string
          qbo_id?: string
          synced_at?: string
          taxable?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_tax_codes_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_tax_codes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_vendor_links: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          org_id: string
          professional_id: string
          qbo_vendor_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          org_id: string
          professional_id: string
          qbo_vendor_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          org_id?: string
          professional_id?: string
          qbo_vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_vendor_links_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "qbo_connections"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_vendor_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_vendor_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_vendor_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_vendor_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "qbo_vendor_links_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          hits: number
          key_hash: string
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          key_hash: string
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          key_hash?: string
          window_start?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          invoice_id: string
          issued_on: string
          number: string
          org_id: string
          payment_id: string
          pdf_file_id: string | null
          seq: number
          year: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          invoice_id: string
          issued_on: string
          number: string
          org_id: string
          payment_id: string
          pdf_file_id?: string | null
          seq: number
          year: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          invoice_id?: string
          issued_on?: string
          number?: string
          org_id?: string
          payment_id?: string
          pdf_file_id?: string | null
          seq?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipts_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "receipts_payment_fkey"
            columns: ["org_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "receipts_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_sources: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          error_code: string | null
          id: string
          invoice_id: string
          org_id: string
          payment_id: string
          processed_at: string | null
          provider_ref: string | null
          reason: string
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          error_code?: string | null
          id?: string
          invoice_id: string
          org_id: string
          payment_id: string
          processed_at?: string | null
          provider_ref?: string | null
          reason: string
          status: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          error_code?: string | null
          id?: string
          invoice_id?: string
          org_id?: string
          payment_id?: string
          processed_at?: string | null
          provider_ref?: string | null
          reason?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "refunds_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "refunds_payment_fkey"
            columns: ["org_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      retention_grid_prices: {
        Row: {
          client_price_cents: number
          duration: number
          grid_id: string
          org_id: string
        }
        Insert: {
          client_price_cents: number
          duration: number
          grid_id: string
          org_id: string
        }
        Update: {
          client_price_cents?: number
          duration?: number
          grid_id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_grid_prices_grid_fkey"
            columns: ["org_id", "grid_id"]
            isOneToOne: false
            referencedRelation: "retention_grids"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      retention_grid_tiers: {
        Row: {
          grid_id: string
          org_id: string
          retention_pct: number
          threshold_sessions: number
        }
        Insert: {
          grid_id: string
          org_id: string
          retention_pct: number
          threshold_sessions: number
        }
        Update: {
          grid_id?: string
          org_id?: string
          retention_pct?: number
          threshold_sessions?: number
        }
        Relationships: [
          {
            foreignKeyName: "retention_grid_tiers_grid_fkey"
            columns: ["org_id", "grid_id"]
            isOneToOne: false
            referencedRelation: "retention_grids"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      retention_grids: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          note: string | null
          org_id: string
          title_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          note?: string | null
          org_id: string
          title_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          note?: string | null
          org_id?: string
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_grids_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "retention_grids_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_grids_title_fkey"
            columns: ["org_id", "title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "retention_grids_title_fkey"
            columns: ["org_id", "title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_key: string
          role: string
        }
        Insert: {
          permission_key: string
          role: string
        }
        Update: {
          permission_key?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          is_system: boolean
          key: string
          name: string
          org_id: string | null
        }
        Insert: {
          created_at?: string
          is_system?: boolean
          key: string
          name: string
          org_id?: string | null
        }
        Update: {
          created_at?: string
          is_system?: boolean
          key?: string
          name?: string
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_job_dispatches: {
        Row: {
          dispatched_at: string
          id: number
          job_key: string
          org_id: string | null
          outcome: string | null
          reconciled_at: string | null
          request_id: number
          trigger: string
        }
        Insert: {
          dispatched_at?: string
          id?: never
          job_key: string
          org_id?: string | null
          outcome?: string | null
          reconciled_at?: string | null
          request_id: number
          trigger: string
        }
        Update: {
          dispatched_at?: string
          id?: never
          job_key?: string
          org_id?: string | null
          outcome?: string | null
          reconciled_at?: string | null
          request_id?: number
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_job_dispatches_job_key_fkey"
            columns: ["job_key"]
            isOneToOne: false
            referencedRelation: "scheduled_jobs"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "scheduled_job_dispatches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_job_runs: {
        Row: {
          detail: string | null
          finished_at: string | null
          id: string
          job_key: string
          org_id: string | null
          run_local_date: string | null
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          detail?: string | null
          finished_at?: string | null
          id?: string
          job_key: string
          org_id?: string | null
          run_local_date?: string | null
          started_at?: string
          status?: string
          trigger: string
        }
        Update: {
          detail?: string | null
          finished_at?: string | null
          id?: string
          job_key?: string
          org_id?: string | null
          run_local_date?: string | null
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_job_runs_job_key_fkey"
            columns: ["job_key"]
            isOneToOne: false
            referencedRelation: "scheduled_jobs"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "scheduled_job_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_jobs: {
        Row: {
          created_at: string
          cron_job_name: string | null
          description: string
          function_name: string | null
          is_active: boolean
          is_maintenance: boolean
          key: string
          kind: string
          label: string
          local_hour: number | null
          module_key: string
          sql_function: string | null
        }
        Insert: {
          created_at?: string
          cron_job_name?: string | null
          description: string
          function_name?: string | null
          is_active?: boolean
          is_maintenance?: boolean
          key: string
          kind: string
          label: string
          local_hour?: number | null
          module_key: string
          sql_function?: string | null
        }
        Update: {
          created_at?: string
          cron_job_name?: string | null
          description?: string
          function_name?: string | null
          is_active?: boolean
          is_maintenance?: boolean
          key?: string
          kind?: string
          label?: string
          local_hour?: number | null
          module_key?: string
          sql_function?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_jobs_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      secure_link_purposes: {
        Row: {
          accept_rpc: string | null
          created_at: string
          creates_account: boolean
          default_ttl: string
          key: string
          max_ttl: string
          max_uses: number
          module_key: string
          requires_session: boolean
          resolve_rpc: string
          view_permission: string
        }
        Insert: {
          accept_rpc?: string | null
          created_at?: string
          creates_account?: boolean
          default_ttl: string
          key: string
          max_ttl: string
          max_uses?: number
          module_key: string
          requires_session?: boolean
          resolve_rpc: string
          view_permission: string
        }
        Update: {
          accept_rpc?: string | null
          created_at?: string
          creates_account?: boolean
          default_ttl?: string
          key?: string
          max_ttl?: string
          max_uses?: number
          module_key?: string
          requires_session?: boolean
          resolve_rpc?: string
          view_permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "secure_link_purposes_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "secure_link_purposes_view_permission_fkey"
            columns: ["view_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      secure_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          last_opened_at: string | null
          max_uses: number
          org_id: string
          purpose: string
          revoked_at: string | null
          revoked_by: string | null
          scope: Json
          subject_id: string
          subject_type: string
          token_hash: string
          updated_at: string
          use_count: number
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          last_opened_at?: string | null
          max_uses: number
          org_id: string
          purpose: string
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: Json
          subject_id: string
          subject_type: string
          token_hash: string
          updated_at?: string
          use_count?: number
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          last_opened_at?: string | null
          max_uses?: number
          org_id?: string
          purpose?: string
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: Json
          subject_id?: string
          subject_type?: string
          token_hash?: string
          updated_at?: string
          use_count?: number
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "secure_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "secure_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secure_links_purpose_fkey"
            columns: ["purpose"]
            isOneToOne: false
            referencedRelation: "secure_link_purposes"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "secure_links_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      service_families: {
        Row: {
          code: number
          created_at: string
          id: string
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: number
          created_at?: string
          id?: string
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: number
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_families_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_rate_variants: {
        Row: {
          amount_cents: number | null
          created_at: string
          created_by: string | null
          discount_kind: string
          effective_from: string
          effective_to: string | null
          id: string
          org_id: string
          percent: number | null
          profession_title_id: string | null
          service_id: string
          variant: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          created_by?: string | null
          discount_kind: string
          effective_from: string
          effective_to?: string | null
          id?: string
          org_id: string
          percent?: number | null
          profession_title_id?: string | null
          service_id: string
          variant: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          created_by?: string | null
          discount_kind?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          org_id?: string
          percent?: number | null
          profession_title_id?: string | null
          service_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_rate_variants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_rate_variants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_rate_variants_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "service_rate_variants_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "service_rate_variants_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "service_rate_variants_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      service_titles: {
        Row: {
          created_at: string
          org_id: string
          profession_title_id: string
          service_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          profession_title_id: string
          service_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          profession_title_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_titles_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "service_titles_service_fkey"
            columns: ["org_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "service_titles_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "service_titles_title_fkey"
            columns: ["org_id", "profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      services: {
        Row: {
          buffer_after_minutes: number
          code: number
          colour: string | null
          created_at: string
          created_by: string | null
          description: string | null
          duration_minutes: number
          family_id: string
          fixed_price_cents: number | null
          for_two: boolean
          grid_duration: number | null
          id: string
          is_active: boolean
          key: string
          kind: string
          name: string
          org_id: string
          price_source: string
          sort_order: number
          tax_rule: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          buffer_after_minutes?: number
          code: number
          colour?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          family_id: string
          fixed_price_cents?: number | null
          for_two?: boolean
          grid_duration?: number | null
          id?: string
          is_active?: boolean
          key: string
          kind: string
          name: string
          org_id: string
          price_source: string
          sort_order?: number
          tax_rule?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          buffer_after_minutes?: number
          code?: number
          colour?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          family_id?: string
          fixed_price_cents?: number | null
          for_two?: boolean
          grid_duration?: number | null
          id?: string
          is_active?: boolean
          key?: string
          kind?: string
          name?: string
          org_id?: string
          price_source?: string
          sort_order?: number
          tax_rule?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "services_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "services_family_fkey"
            columns: ["org_id", "family_id"]
            isOneToOne: false
            referencedRelation: "service_families"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "services_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      signature_request_signers: {
        Row: {
          created_at: string
          documenso_recipient_id: string | null
          email: string
          id: string
          name: string
          org_id: string
          redacted_at: string | null
          rejected_at: string | null
          request_id: string
          role: string
          signed_at: string | null
          signing_order: number
          status: string
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          documenso_recipient_id?: string | null
          email: string
          id?: string
          name: string
          org_id: string
          redacted_at?: string | null
          rejected_at?: string | null
          request_id: string
          role: string
          signed_at?: string | null
          signing_order: number
          status?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          documenso_recipient_id?: string | null
          email?: string
          id?: string
          name?: string
          org_id?: string
          redacted_at?: string | null
          rejected_at?: string | null
          request_id?: string
          role?: string
          signed_at?: string | null
          signing_order?: number
          status?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_request_signers_request_id_org_id_fkey"
            columns: ["request_id", "org_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      signature_request_syncs: {
        Row: {
          attempted_at: string
          error_code: string | null
          failing_since: string | null
          org_id: string
          reported: Json
          request_id: string
          synced_at: string | null
        }
        Insert: {
          attempted_at: string
          error_code?: string | null
          failing_since?: string | null
          org_id: string
          reported?: Json
          request_id: string
          synced_at?: string | null
        }
        Update: {
          attempted_at?: string
          error_code?: string | null
          failing_since?: string | null
          org_id?: string
          reported?: Json
          request_id?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_request_syncs_request_id_org_id_fkey"
            columns: ["request_id", "org_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      signature_requests: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_event_at: string | null
          created_at: string
          envelope_id: string | null
          expired_at: string | null
          expires_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_send_at: string | null
          module_key: string
          org_id: string
          page_count: number | null
          purpose: string
          rejected_at: string | null
          rejection_reason: string | null
          send_started_at: string | null
          sent_at: string | null
          sent_by: string | null
          signed_file_id: string | null
          signed_sha256: string | null
          source_file_id: string | null
          status: string
          subject_id: string
          subject_type: string
          superseded_envelope_ids: string[]
          template_version_id: string | null
          title: string
          updated_at: string
          view_permission: string
          viewed_at: string | null
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_event_at?: string | null
          created_at?: string
          envelope_id?: string | null
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          idempotency_key: string
          last_error?: string | null
          last_send_at?: string | null
          module_key: string
          org_id: string
          page_count?: number | null
          purpose: string
          rejected_at?: string | null
          rejection_reason?: string | null
          send_started_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          signed_file_id?: string | null
          signed_sha256?: string | null
          source_file_id?: string | null
          status?: string
          subject_id: string
          subject_type: string
          superseded_envelope_ids?: string[]
          template_version_id?: string | null
          title: string
          updated_at?: string
          view_permission: string
          viewed_at?: string | null
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_event_at?: string | null
          created_at?: string
          envelope_id?: string | null
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          last_send_at?: string | null
          module_key?: string
          org_id?: string
          page_count?: number | null
          purpose?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          send_started_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          signed_file_id?: string | null
          signed_sha256?: string | null
          source_file_id?: string | null
          status?: string
          subject_id?: string
          subject_type?: string
          superseded_envelope_ids?: string[]
          template_version_id?: string | null
          title?: string
          updated_at?: string
          view_permission?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_requests_cancelled_by_org_id_fkey"
            columns: ["cancelled_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
          {
            foreignKeyName: "signature_requests_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "signature_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_sent_by_org_id_fkey"
            columns: ["sent_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
          {
            foreignKeyName: "signature_requests_signed_file_id_fkey"
            columns: ["signed_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_template_version_id_org_id_fkey"
            columns: ["template_version_id", "org_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "signature_requests_view_permission_module_key_fkey"
            columns: ["view_permission", "module_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key", "module_key"]
          },
        ]
      }
      signing_settings: {
        Row: {
          base_url: string | null
          expiry_days: number
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_url?: string | null
          expiry_days?: number
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_url?: string | null
          expiry_days?: number
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signing_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signing_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sms_consents: {
        Row: {
          created_at: string
          granted_at: string | null
          id: string
          note: string | null
          org_id: string
          phone_e164: string
          source: string
          status: string
          subject_id: string | null
          subject_type: string | null
          updated_at: string
          updated_by: string | null
          withdrawn_at: string | null
        }
        Insert: {
          created_at?: string
          granted_at?: string | null
          id?: string
          note?: string | null
          org_id: string
          phone_e164: string
          source: string
          status: string
          subject_id?: string | null
          subject_type?: string | null
          updated_at?: string
          updated_by?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          created_at?: string
          granted_at?: string | null
          id?: string
          note?: string | null
          org_id?: string
          phone_e164?: string
          source?: string
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          updated_at?: string
          updated_by?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_consents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_consents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          attempts: number
          body: string | null
          body_purged_at: string | null
          claimed_at: string | null
          created_at: string
          did_e164: string | null
          direction: string
          error_code: string | null
          id: string
          kind: string
          media: Json
          org_id: string
          peer_e164: string | null
          provider: string
          provider_msg_id: number | null
          provider_session_id: number | null
          request_id: string | null
          send_after: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          subject_id: string | null
          subject_type: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          body?: string | null
          body_purged_at?: string | null
          claimed_at?: string | null
          created_at?: string
          did_e164?: string | null
          direction: string
          error_code?: string | null
          id?: string
          kind: string
          media?: Json
          org_id: string
          peer_e164?: string | null
          provider?: string
          provider_msg_id?: number | null
          provider_session_id?: number | null
          request_id?: string | null
          send_after?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status: string
          subject_id?: string | null
          subject_type?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          body?: string | null
          body_purged_at?: string | null
          claimed_at?: string | null
          created_at?: string
          did_e164?: string | null
          direction?: string
          error_code?: string | null
          id?: string
          kind?: string
          media?: Json
          org_id?: string
          peer_e164?: string | null
          provider?: string
          provider_msg_id?: number | null
          provider_session_id?: number | null
          request_id?: string | null
          send_after?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sms_provider_sessions: {
        Row: {
          access_expires_at: string | null
          access_secret_id: string | null
          base_url: string | null
          channel_cached_at: string | null
          channel_name: string | null
          lock_owner: string | null
          locked_until: string | null
          org_id: string
          refresh_expires_at: string | null
          refresh_secret_id: string | null
          updated_at: string
        }
        Insert: {
          access_expires_at?: string | null
          access_secret_id?: string | null
          base_url?: string | null
          channel_cached_at?: string | null
          channel_name?: string | null
          lock_owner?: string | null
          locked_until?: string | null
          org_id: string
          refresh_expires_at?: string | null
          refresh_secret_id?: string | null
          updated_at?: string
        }
        Update: {
          access_expires_at?: string | null
          access_secret_id?: string | null
          base_url?: string | null
          channel_cached_at?: string | null
          channel_name?: string | null
          lock_owner?: string | null
          locked_until?: string | null
          org_id?: string
          refresh_expires_at?: string | null
          refresh_secret_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_provider_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_thread_links: {
        Row: {
          candidate_client_ids: string[]
          client_id: string | null
          created_at: string
          id: string
          linked_at: string | null
          linked_by: string | null
          org_id: string
          peer_e164: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          candidate_client_ids?: string[]
          client_id?: string | null
          created_at?: string
          id?: string
          linked_at?: string | null
          linked_by?: string | null
          org_id: string
          peer_e164: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          candidate_client_ids?: string[]
          client_id?: string | null
          created_at?: string
          id?: string
          linked_at?: string | null
          linked_by?: string | null
          org_id?: string
          peer_e164?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_thread_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sms_thread_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      special_agreements: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          is_active: boolean
          note: string
          org_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          is_active?: boolean
          note: string
          org_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          is_active?: boolean
          note?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "special_agreements_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "special_agreements_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "special_agreements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "special_agreements_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      staff_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          invited_by: string | null
          org_id: string
          role: string | null
          secure_link_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          display_name: string
          email: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: string | null
          secure_link_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: string | null
          secure_link_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invitations_accepted_user_id_fkey"
            columns: ["accepted_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invitations_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "staff_invitations_secure_link_id_fkey"
            columns: ["secure_link_id"]
            isOneToOne: true
            referencedRelation: "secure_links"
            referencedColumns: ["id"]
          },
        ]
      }
      statements: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          payer_client_id: string
          pdf_file_id: string | null
          period_from: string
          period_to: string
          year: number
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          payer_client_id: string
          pdf_file_id?: string | null
          period_from: string
          period_to: string
          year: number
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          payer_client_id?: string
          pdf_file_id?: string | null
          period_from?: string
          period_to?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "statements_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "statements_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "statements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statements_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "statements_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "statements_pdf_file_id_fkey"
            columns: ["pdf_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
        ]
      }
      stored_files: {
        Row: {
          bucket: string
          confirmed_at: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          ext: string
          id: string
          mime_type: string
          module_key: string
          object_path: string
          org_id: string
          original_name: string
          owner_permission: string | null
          owner_profile_id: string | null
          purpose: string
          retain_until: string | null
          sha256: string | null
          size_bytes: number
          status: string
          subject_id: string
          subject_type: string
          updated_at: string
          uploaded_by: string | null
          view_permission: string | null
        }
        Insert: {
          bucket: string
          confirmed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          ext: string
          id?: string
          mime_type: string
          module_key: string
          object_path: string
          org_id: string
          original_name: string
          owner_permission?: string | null
          owner_profile_id?: string | null
          purpose: string
          retain_until?: string | null
          sha256?: string | null
          size_bytes: number
          status?: string
          subject_id: string
          subject_type: string
          updated_at?: string
          uploaded_by?: string | null
          view_permission?: string | null
        }
        Update: {
          bucket?: string
          confirmed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          ext?: string
          id?: string
          mime_type?: string
          module_key?: string
          object_path?: string
          org_id?: string
          original_name?: string
          owner_permission?: string | null
          owner_profile_id?: string | null
          purpose?: string
          retain_until?: string | null
          sha256?: string | null
          size_bytes?: number
          status?: string
          subject_id?: string
          subject_type?: string
          updated_at?: string
          uploaded_by?: string | null
          view_permission?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stored_files_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "stored_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_files_owner_permission_fkey"
            columns: ["owner_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "stored_files_owner_profile_id_org_id_fkey"
            columns: ["owner_profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
          {
            foreignKeyName: "stored_files_purpose_module_key_bucket_fkey"
            columns: ["purpose", "module_key", "bucket"]
            isOneToOne: false
            referencedRelation: "upload_purposes"
            referencedColumns: ["key", "module_key", "bucket"]
          },
          {
            foreignKeyName: "stored_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "stored_files_view_permission_fkey"
            columns: ["view_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      stripe_charges: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          failure_code: string | null
          finished_at: string | null
          id: string
          invoice_id: string
          kind: string
          org_id: string
          payer_client_id: string
          payment_id: string | null
          payment_intent_id: string | null
          status: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          invoice_id: string
          kind: string
          org_id: string
          payer_client_id: string
          payment_id?: string | null
          payment_intent_id?: string | null
          status?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          invoice_id?: string
          kind?: string
          org_id?: string
          payer_client_id?: string
          payment_id?: string | null
          payment_intent_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "stripe_charges_invoice_fkey"
            columns: ["org_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "stripe_charges_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "stripe_charges_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "stripe_charges_payment_fkey"
            columns: ["org_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_status: string
          consent_at: string | null
          created_at: string
          org_id: string
          payer_client_id: string
          payment_method_id: string | null
          removed_at: string | null
          removed_by: string | null
          stripe_customer_id: string
          updated_at: string
        }
        Insert: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_status?: string
          consent_at?: string | null
          created_at?: string
          org_id: string
          payer_client_id: string
          payment_method_id?: string | null
          removed_at?: string | null
          removed_by?: string | null
          stripe_customer_id: string
          updated_at?: string
        }
        Update: {
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_status?: string
          consent_at?: string | null
          created_at?: string
          org_id?: string
          payer_client_id?: string
          payment_method_id?: string | null
          removed_at?: string | null
          removed_by?: string | null
          stripe_customer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "stripe_customers_payer_fkey"
            columns: ["org_id", "payer_client_id"]
            isOneToOne: true
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "stripe_customers_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          org_id: string
          rate: number
          tax: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          org_id: string
          rate: number
          tax: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          org_id?: string
          rate?: number
          tax?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tax_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_purposes: {
        Row: {
          bucket: string
          created_at: string
          key: string
          max_bytes: number
          max_image_side: number | null
          mime_types: string[]
          module_key: string
          owner_permission: string | null
          retain_days: number | null
          upload_permission: string
          view_permission: string | null
        }
        Insert: {
          bucket: string
          created_at?: string
          key: string
          max_bytes: number
          max_image_side?: number | null
          mime_types: string[]
          module_key: string
          owner_permission?: string | null
          retain_days?: number | null
          upload_permission: string
          view_permission?: string | null
        }
        Update: {
          bucket?: string
          created_at?: string
          key?: string
          max_bytes?: number
          max_image_side?: number | null
          mime_types?: string[]
          module_key?: string
          owner_permission?: string | null
          retain_days?: number | null
          upload_permission?: string
          view_permission?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_purposes_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "upload_purposes_owner_permission_fkey"
            columns: ["owner_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "upload_purposes_upload_permission_fkey"
            columns: ["upload_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "upload_purposes_view_permission_fkey"
            columns: ["view_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      user_permission_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          granted: boolean
          org_id: string
          permission_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          granted: boolean
          org_id: string
          permission_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          granted?: boolean
          org_id?: string
          permission_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_permission_overrides_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "user_permission_overrides_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          key: string
          org_id: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          org_id: string
          updated_at?: string
          user_id: string
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          org_id?: string
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "user_roles_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id", "org_id"]
          },
        ]
      }
      video_connection_tokens: {
        Row: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          created_at: string
          key_version: number
          org_id: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          created_at?: string
          key_version?: number
          org_id: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          connection_id?: string
          created_at?: string
          key_version?: number
          org_id?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_connection_tokens_connection_fkey"
            columns: ["org_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "video_connections"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      video_connections: {
        Row: {
          account_email: string | null
          connected_at: string | null
          connected_by: string | null
          created_at: string
          disconnected_at: string | null
          external_account_id: string | null
          external_user_id: string | null
          id: string
          org_id: string
          professional_id: string
          provider: string
          reconnect_reason: string | null
          scopes: string[]
          state: string
          tokens_refreshed_at: string | null
          updated_at: string
        }
        Insert: {
          account_email?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          external_account_id?: string | null
          external_user_id?: string | null
          id?: string
          org_id: string
          professional_id: string
          provider?: string
          reconnect_reason?: string | null
          scopes?: string[]
          state?: string
          tokens_refreshed_at?: string | null
          updated_at?: string
        }
        Update: {
          account_email?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          external_account_id?: string | null
          external_user_id?: string | null
          id?: string
          org_id?: string
          professional_id?: string
          provider?: string
          reconnect_reason?: string | null
          scopes?: string[]
          state?: string
          tokens_refreshed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "video_connections_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "video_connections_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "video_connections_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "video_connections_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      video_tasks: {
        Row: {
          appointment_id: string
          attempts: number
          created_at: string
          generation: number
          last_error_code: string | null
          locked_until: string | null
          next_attempt_at: string
          org_id: string
          state: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          attempts?: number
          created_at?: string
          generation?: number
          last_error_code?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          org_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          attempts?: number
          created_at?: string
          generation?: number
          last_error_code?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          org_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_tasks_appointment_fkey"
            columns: ["org_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      waitlist_contacts: {
        Row: {
          at: string
          by_user: string | null
          entry_id: string
          id: string
          kind: string
          org_id: string
          outcome: string
        }
        Insert: {
          at?: string
          by_user?: string | null
          entry_id: string
          id?: string
          kind: string
          org_id: string
          outcome: string
        }
        Update: {
          at?: string
          by_user?: string | null
          entry_id?: string
          id?: string
          kind?: string
          org_id?: string
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_contacts_by_user_fkey"
            columns: ["by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "waitlist_contacts_entry_fkey"
            columns: ["org_id", "entry_id"]
            isOneToOne: false
            referencedRelation: "waitlist_entries"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          availability_days: number[]
          availability_periods: string[]
          bridge_professional_id: string | null
          client_id: string | null
          clientele_id: string | null
          consent_signed_at: string | null
          created_at: string
          demande_id: string
          exit_reason: string | null
          exited_at: string | null
          exited_by: string | null
          external_ref: string | null
          fee_invoice_id: string | null
          fee_status: string
          fee_waived_reason: string | null
          id: string
          language: string
          last_contact_at: string | null
          modality: string
          motif_ids: string[]
          next_contact_at: string | null
          org_id: string
          payer_kind: string
          preferred_pro_gender: string
          priority: string
          priority_reason: string | null
          registered_at: string
          registered_by: string | null
          state: string
          target_profession_title_id: string | null
          target_professional_id: string | null
          updated_at: string
        }
        Insert: {
          availability_days?: number[]
          availability_periods?: string[]
          bridge_professional_id?: string | null
          client_id?: string | null
          clientele_id?: string | null
          consent_signed_at?: string | null
          created_at?: string
          demande_id: string
          exit_reason?: string | null
          exited_at?: string | null
          exited_by?: string | null
          external_ref?: string | null
          fee_invoice_id?: string | null
          fee_status?: string
          fee_waived_reason?: string | null
          id?: string
          language?: string
          last_contact_at?: string | null
          modality?: string
          motif_ids?: string[]
          next_contact_at?: string | null
          org_id: string
          payer_kind?: string
          preferred_pro_gender?: string
          priority?: string
          priority_reason?: string | null
          registered_at?: string
          registered_by?: string | null
          state?: string
          target_profession_title_id?: string | null
          target_professional_id?: string | null
          updated_at?: string
        }
        Update: {
          availability_days?: number[]
          availability_periods?: string[]
          bridge_professional_id?: string | null
          client_id?: string | null
          clientele_id?: string | null
          consent_signed_at?: string | null
          created_at?: string
          demande_id?: string
          exit_reason?: string | null
          exited_at?: string | null
          exited_by?: string | null
          external_ref?: string | null
          fee_invoice_id?: string | null
          fee_status?: string
          fee_waived_reason?: string | null
          id?: string
          language?: string
          last_contact_at?: string | null
          modality?: string
          motif_ids?: string[]
          next_contact_at?: string | null
          org_id?: string
          payer_kind?: string
          preferred_pro_gender?: string
          priority?: string
          priority_reason?: string | null
          registered_at?: string
          registered_by?: string | null
          state?: string
          target_profession_title_id?: string | null
          target_professional_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_bridge_fkey"
            columns: ["org_id", "bridge_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_bridge_fkey"
            columns: ["org_id", "bridge_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_bridge_fkey"
            columns: ["org_id", "bridge_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_bridge_fkey"
            columns: ["org_id", "bridge_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "waitlist_entries_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_clientele_fkey"
            columns: ["org_id", "clientele_id"]
            isOneToOne: false
            referencedRelation: "clienteles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_clientele_fkey"
            columns: ["org_id", "clientele_id"]
            isOneToOne: false
            referencedRelation: "clienteles_catalog"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_demande_fkey"
            columns: ["org_id", "demande_id"]
            isOneToOne: false
            referencedRelation: "demandes_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_exited_by_fkey"
            columns: ["exited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "waitlist_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_professional_fkey"
            columns: ["org_id", "target_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_professional_fkey"
            columns: ["org_id", "target_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_professional_fkey"
            columns: ["org_id", "target_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_professional_fkey"
            columns: ["org_id", "target_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "waitlist_entries_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "waitlist_entries_title_fkey"
            columns: ["org_id", "target_profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_entries_title_fkey"
            columns: ["org_id", "target_profession_title_id"]
            isOneToOne: false
            referencedRelation: "profession_titles_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      waitlist_offers: {
        Row: {
          channel: string
          created_at: string
          entry_id: string
          expires_at: string | null
          id: string
          offered_at: string
          offered_by: string | null
          org_id: string
          professional_id: string
          responded_at: string | null
          response: string
          secure_link_id: string | null
          slots: Json
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          entry_id: string
          expires_at?: string | null
          id?: string
          offered_at?: string
          offered_by?: string | null
          org_id: string
          professional_id: string
          responded_at?: string | null
          response?: string
          secure_link_id?: string | null
          slots?: Json
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          entry_id?: string
          expires_at?: string | null
          id?: string
          offered_at?: string
          offered_by?: string | null
          org_id?: string
          professional_id?: string
          responded_at?: string | null
          response?: string
          secure_link_id?: string | null
          slots?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_offers_entry_fkey"
            columns: ["org_id", "entry_id"]
            isOneToOne: false
            referencedRelation: "waitlist_entries"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_offers_offered_by_fkey"
            columns: ["offered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "waitlist_offers_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_offers_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_offers_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "waitlist_offers_professional_fkey"
            columns: ["org_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempts: number
          claim_token: string | null
          claimed_at: string | null
          completed_at: string | null
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          org_id: string
          payload: Json | null
          provider: string
          received_at: string
          status: string
        }
        Insert: {
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          event_id: string
          event_type: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          org_id: string
          payload?: Json | null
          provider: string
          received_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          org_id?: string
          payload?: Json | null
          provider?: string
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      client_consent_campaigns_summary: {
        Row: {
          consent_key: string | null
          created_at: string | null
          created_by: string | null
          failed: number | null
          finished_at: string | null
          id: string | null
          org_id: string | null
          queued: number | null
          sent: number | null
          skipped: number | null
          state: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_consent_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_consent_campaigns_type_fkey"
            columns: ["org_id", "consent_key"]
            isOneToOne: false
            referencedRelation: "client_consent_types"
            referencedColumns: ["org_id", "key"]
          },
        ]
      }
      client_consents_status: {
        Row: {
          client_id: string | null
          consent_id: string | null
          consent_key: string | null
          copy_sent_at: string | null
          due_at: string | null
          in_force: boolean | null
          last_sent_at: string | null
          org_id: string | null
          request_id: string | null
          signed_at: string | null
          signed_file_id: string | null
          source: string | null
          state: string | null
          version_label: string | null
          withdrawn_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_consents_signed_file_id_fkey"
            columns: ["signed_file_id"]
            isOneToOne: false
            referencedRelation: "stored_files"
            referencedColumns: ["id"]
          },
        ]
      }
      client_consents_to_obtain: {
        Row: {
          answered: boolean | null
          client_id: string | null
          client_name: string | null
          consent_key: string | null
          consent_name: string | null
          created_at: string | null
          due_at: string | null
          is_overdue: boolean | null
          language: string | null
          last_sent_at: string | null
          org_id: string | null
          primary_professional_id: string | null
          reminded_at: string | null
          request_id: string | null
          signing_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_consent_requests_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_requests_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_consent_requests_type_fkey"
            columns: ["org_id", "consent_key"]
            isOneToOne: false
            referencedRelation: "client_consent_types"
            referencedColumns: ["org_id", "key"]
          },
        ]
      }
      client_payers_active: {
        Row: {
          client_id: string | null
          expires_on: string | null
          file_number: string | null
          id: string | null
          kind: string | null
          max_amount_cents: number | null
          max_sessions: number | null
          org_id: string | null
          organisation_name: string | null
          session_amount_cents: number | null
          starts_on: string | null
        }
        Insert: {
          client_id?: string | null
          expires_on?: string | null
          file_number?: string | null
          id?: string | null
          kind?: string | null
          max_amount_cents?: number | null
          max_sessions?: number | null
          org_id?: string | null
          organisation_name?: string | null
          session_amount_cents?: number | null
          starts_on?: string | null
        }
        Update: {
          client_id?: string | null
          expires_on?: string | null
          file_number?: string | null
          id?: string | null
          kind?: string | null
          max_amount_cents?: number | null
          max_sessions?: number | null
          org_id?: string | null
          organisation_name?: string | null
          session_amount_cents?: number | null
          starts_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_payers_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_payers_client_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      clienteles_catalog: {
        Row: {
          id: string | null
          key: string | null
          max_age: number | null
          min_age: number | null
          name: string | null
          org_id: string | null
          sort_order: number | null
        }
        Insert: {
          id?: string | null
          key?: string | null
          max_age?: number | null
          min_age?: number | null
          name?: string | null
          org_id?: string | null
          sort_order?: number | null
        }
        Update: {
          id?: string | null
          key?: string | null
          max_age?: number | null
          min_age?: number | null
          name?: string | null
          org_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clienteles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients_directory: {
        Row: {
          archived_at: string | null
          birthday: string | null
          client_number: number | null
          created_at: string | null
          display_name: string | null
          email: string | null
          external_ref: string | null
          file_incomplete: boolean | null
          first_name: string | null
          id: string | null
          is_anonymized: boolean | null
          is_archived: boolean | null
          is_banned: boolean | null
          language: string | null
          last_name: string | null
          merged_into_id: string | null
          mobile_e164: string | null
          org_id: string | null
          primary_professional_id: string | null
          pronouns: string | null
          rate_variant: string | null
          referral_source_id: string | null
          reminders_by_email: boolean | null
          reminders_by_sms: boolean | null
          sex: string | null
          shared_custody: boolean | null
          special_agreement: boolean | null
          tax_exempt: boolean | null
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          birthday?: string | null
          client_number?: number | null
          created_at?: string | null
          display_name?: never
          email?: string | null
          external_ref?: string | null
          file_incomplete?: boolean | null
          first_name?: string | null
          id?: string | null
          is_anonymized?: never
          is_archived?: never
          is_banned?: boolean | null
          language?: string | null
          last_name?: string | null
          merged_into_id?: string | null
          mobile_e164?: string | null
          org_id?: string | null
          primary_professional_id?: string | null
          pronouns?: string | null
          rate_variant?: string | null
          referral_source_id?: string | null
          reminders_by_email?: boolean | null
          reminders_by_sms?: boolean | null
          sex?: string | null
          shared_custody?: boolean | null
          special_agreement?: boolean | null
          tax_exempt?: boolean | null
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          birthday?: string | null
          client_number?: number | null
          created_at?: string | null
          display_name?: never
          email?: string | null
          external_ref?: string | null
          file_incomplete?: boolean | null
          first_name?: string | null
          id?: string | null
          is_anonymized?: never
          is_archived?: never
          is_banned?: boolean | null
          language?: string | null
          last_name?: string | null
          merged_into_id?: string | null
          mobile_e164?: string | null
          org_id?: string | null
          primary_professional_id?: string | null
          pronouns?: string | null
          rate_variant?: string | null
          referral_source_id?: string | null
          reminders_by_email?: boolean | null
          reminders_by_sms?: boolean | null
          sex?: string | null
          shared_custody?: boolean | null
          special_agreement?: boolean | null
          tax_exempt?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_merged_into_fkey"
            columns: ["org_id", "merged_into_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_merged_into_fkey"
            columns: ["org_id", "merged_into_id"]
            isOneToOne: false
            referencedRelation: "clients_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_primary_professional_fkey"
            columns: ["org_id", "primary_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_primary_professional_fkey"
            columns: ["org_id", "primary_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_directory"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_primary_professional_fkey"
            columns: ["org_id", "primary_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_list"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_primary_professional_fkey"
            columns: ["org_id", "primary_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals_readiness"
            referencedColumns: ["org_id", "professional_id"]
          },
          {
            foreignKeyName: "clients_referral_source_fkey"
            columns: ["org_id", "referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "clients_referral_source_fkey"
            columns: ["org_id", "referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      demandes_sources: {
        Row: {
          channel: string | null
          id: string | null
          org_id: string | null
          received_at: string | null
          reference: string | null
          referral_source_id: string | null
          referral_source_name: string | null
          source_campaign: string | null
          source_landing_page: string | null
          source_referrer: string | null
          state: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demandes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demandes_referral_source_fkey"
            columns: ["org_id", "referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demandes_referral_source_fkey"
            columns: ["org_id", "referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources_catalog"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      languages_catalog: {
        Row: {
          code: string | null
          id: string | null
          name: string | null
          org_id: string | null
          sort_order: number | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          name?: string | null
          org_id?: string | null
          sort_order?: number | null
        }
        Update: {
          code?: string | null
          id?: string | null
          name?: string | null
          org_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "languages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      motifs_catalog: {
        Row: {
          category_icon: string | null
          category_id: string | null
          category_key: string | null
          category_name: string | null
          category_sort_order: number | null
          id: string | null
          is_restricted: boolean | null
          key: string | null
          name: string | null
          org_id: string | null
          sort_order: number | null
        }
        Relationships: [
          {
            foreignKeyName: "motifs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      my_client_consents: {
        Row: {
          client_id: string | null
          consent_key: string | null
          due_at: string | null
          signed_at: string | null
          state: string | null
        }
        Relationships: []
      }
      my_clients: {
        Row: {
          birthday: string | null
          client_number: number | null
          display_name: string | null
          email: string | null
          first_linked_at: string | null
          first_name: string | null
          id: string | null
          is_archived: boolean | null
          is_primary: boolean | null
          language: string | null
          last_linked_at: string | null
          last_name: string | null
          mobile_e164: string | null
          org_id: string | null
          pronouns: string | null
          reason: string | null
        }
        Relationships: []
      }
      my_demandes: {
        Row: {
          availability_days: number[] | null
          availability_periods: string[] | null
          beneficiary: string | null
          client_id: string | null
          clientele_id: string | null
          concerns: string | null
          id: string | null
          insurer: string | null
          language: string | null
          matched_at: string | null
          modality: string | null
          motif_ids: string[] | null
          org_id: string | null
          participants: Json | null
          payer_kind: string | null
          preferred_pro_gender: string | null
          previous_therapy: boolean | null
          profession_title_id: string | null
          received_at: string | null
          reference: string | null
        }
        Relationships: []
      }
      my_waitlist_entries: {
        Row: {
          availability_days: number[] | null
          availability_periods: string[] | null
          client_id: string | null
          clientele_id: string | null
          demande_id: string | null
          id: string | null
          language: string | null
          modality: string | null
          motif_ids: string[] | null
          org_id: string | null
          preferred_pro_gender: string | null
          priority: string | null
          rank: number | null
          registered_at: string | null
          state: string | null
        }
        Relationships: []
      }
      profession_titles_catalog: {
        Row: {
          category_id: string | null
          id: string | null
          key: string | null
          name: string | null
          name_feminine: string | null
          name_masculine: string | null
          order_id: string | null
          org_id: string | null
          sort_order: number | null
        }
        Insert: {
          category_id?: string | null
          id?: string | null
          key?: string | null
          name?: string | null
          name_feminine?: string | null
          name_masculine?: string | null
          order_id?: string | null
          org_id?: string | null
          sort_order?: number | null
        }
        Update: {
          category_id?: string | null
          id?: string | null
          key?: string | null
          name?: string | null
          name_feminine?: string | null
          name_masculine?: string | null
          order_id?: string | null
          org_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profession_titles_category_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "profession_categories"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "profession_titles_order_fkey"
            columns: ["org_id", "order_id"]
            isOneToOne: false
            referencedRelation: "professional_orders"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "profession_titles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals_directory: {
        Row: {
          accepting_new_clients: boolean | null
          availability_periods: string[] | null
          category_key: string | null
          clienteles: Json | null
          display_name: string | null
          gender: string | null
          id: string | null
          insurance_status: string | null
          language_codes: string[] | null
          licence_number: string | null
          matching_note: string | null
          matching_priority_reason: string | null
          min_client_age: number | null
          motif_ids: string[] | null
          motif_keys: string[] | null
          new_client_places: number | null
          new_client_places_set_at: string | null
          order_acronym: string | null
          org_id: string | null
          primary_title_id: string | null
          primary_title_key: string | null
          primary_title_label: string | null
          primary_title_name: string | null
          professions: Json | null
          ready: boolean | null
          refused_motif_ids: string[] | null
          status: string | null
          updated_at: string | null
          women_only: boolean | null
          years_experience: number | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals_list: {
        Row: {
          accepting_new_clients: boolean | null
          clientele_ids: string[] | null
          created_at: string | null
          deactivation_reason_id: string | null
          documents_done: number | null
          documents_required: number | null
          documents_to_review: number | null
          email: string | null
          email_matches_login: boolean | null
          first_name: string | null
          gender: string | null
          has_account: boolean | null
          id: string | null
          insurance_expires_on: string | null
          insurance_status: string | null
          language_ids: string[] | null
          last_name: string | null
          matching_complete: boolean | null
          motif_ids: string[] | null
          org_id: string | null
          photo_file_id: string | null
          primary_licence_number: string | null
          primary_title_id: string | null
          ready: boolean | null
          status: string | null
          status_changed_at: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_deactivation_reason_fkey"
            columns: ["org_id", "deactivation_reason_id"]
            isOneToOne: false
            referencedRelation: "deactivation_reasons"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "professionals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals_readiness: {
        Row: {
          account_created: boolean | null
          consent_ok: boolean | null
          contract_signed: boolean | null
          documents_done: number | null
          documents_missing: string[] | null
          documents_ok: boolean | null
          documents_required: number | null
          email_matches_login: boolean | null
          has_clientele: boolean | null
          has_language: boolean | null
          has_motif: boolean | null
          has_profession: boolean | null
          insurance_expires_on: string | null
          insurance_ok: boolean | null
          insurance_status: string | null
          licences_ok: boolean | null
          matching_complete: boolean | null
          org_id: string | null
          photo_ok: boolean | null
          professional_id: string | null
          ready: boolean | null
          restricted_motifs_ok: boolean | null
          submission_approved: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_sources_catalog: {
        Row: {
          id: string | null
          name: string | null
          org_id: string | null
          sort_order: number | null
        }
        Insert: {
          id?: string | null
          name?: string | null
          org_id?: string | null
          sort_order?: number | null
        }
        Update: {
          id?: string | null
          name?: string | null
          org_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      services_catalog: {
        Row: {
          buffer_after_minutes: number | null
          code: number | null
          colour: string | null
          description: string | null
          duration_minutes: number | null
          family_code: number | null
          family_id: string | null
          family_name: string | null
          family_sort_order: number | null
          fixed_price_cents: number | null
          for_two: boolean | null
          grid_duration: number | null
          id: string | null
          key: string | null
          kind: string | null
          name: string | null
          org_id: string | null
          price_source: string | null
          sort_order: number | null
          tax_rule: string | null
          title_ids: string[] | null
          title_keys: string[] | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "services_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_threads: {
        Row: {
          consent_status: string | null
          last_body: string | null
          last_body_purged: boolean | null
          last_direction: string | null
          last_has_media: boolean | null
          last_inbound_at: string | null
          last_message_at: string | null
          last_status: string | null
          message_count: number | null
          org_id: string | null
          peer_e164: string | null
          subject_id: string | null
          subject_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_staff_invitation: {
        Args: { p_payload: Json; p_token_hash: string; p_user_id: string }
        Returns: Json
      }
      acquire_mail_sync_lease: {
        Args: {
          p_connection_id: string
          p_org_id: string
          p_seconds?: number
          p_token: string
        }
        Returns: boolean
      }
      acquire_sms_provider_lock: {
        Args: { p_org_id: string; p_owner: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      activate_professional: {
        Args: { p_id: string; p_override_reason?: string }
        Returns: {
          account_change: string
          profile_id: string
          status: string
        }[]
      }
      add_availability_exception: {
        Args: {
          p_ends_at: string
          p_kind: string
          p_label: string
          p_professional_id: string
          p_starts_at: string
        }
        Returns: string
      }
      add_billing_policy: {
        Args: {
          p_effective_from: string
          p_fee_mode: string
          p_file_opening_service_id: string
          p_first_fee_percent: number
          p_late_notice_hours: number
          p_next_fee_percent: number
        }
        Returns: string
      }
      add_demande_task: {
        Args: {
          p_assigned_to?: string
          p_demande_id: string
          p_due_at: string
          p_kind: string
        }
        Returns: string
      }
      add_interac_notice: {
        Args: {
          p_amount_cents: number
          p_message?: string
          p_received_on: string
          p_reference?: string
          p_sender_name: string
        }
        Returns: string
      }
      add_invoice_line: {
        Args: {
          p_description?: string
          p_invoice_id: string
          p_line_type: string
          p_professional_id?: string
          p_quantity?: number
          p_service_id?: string
          p_taxable?: boolean
          p_unit_price_cents?: number
        }
        Returns: string
      }
      add_module_tester: {
        Args: { p_key: string; p_user_id: string }
        Returns: undefined
      }
      add_payout_adjustment: {
        Args: { p_amount_cents: number; p_note: string; p_period_id: string }
        Returns: string
      }
      add_service_rate_variant: {
        Args: {
          p_amount_cents: number
          p_discount_kind: string
          p_effective_from: string
          p_percent: number
          p_service_id: string
          p_title_id: string
          p_variant: string
        }
        Returns: string
      }
      add_tax_rate: {
        Args: { p_effective_from: string; p_rate: number; p_tax: string }
        Returns: string
      }
      add_waitlist_offer: {
        Args: { p_id: string; p_professional_id: string; p_slots?: Json }
        Returns: string
      }
      ai_draft_context_for_service: {
        Args: {
          p_actor: string
          p_client_id: string
          p_org_id: string
          p_thread_id: string
        }
        Returns: Json
      }
      anonymize_client: { Args: { p_id: string }; Returns: undefined }
      answer_proposition_for_service: {
        Args: {
          p_appointment_id: string
          p_decline_reason?: string
          p_token_hash: string
        }
        Returns: Json
      }
      answer_waitlist_followup_for_service: {
        Args: { p_answer: string; p_token_hash: string }
        Returns: Json
      }
      answer_waitlist_offer: {
        Args: { p_id: string; p_offer_id: string; p_response: string }
        Returns: undefined
      }
      apply_email_event: {
        Args: {
          p_at: string
          p_email_log_id: string
          p_org_id: string
          p_resend_id: string
          p_status: string
        }
        Returns: string
      }
      apply_mail_label_changes: {
        Args: { p_changes: Json; p_connection_id: string; p_org_id: string }
        Returns: number
      }
      apply_professional_submission: {
        Args: { p_fields?: string[]; p_submission_id: string }
        Returns: undefined
      }
      apply_signing_event: {
        Args: {
          p_at: string
          p_envelope_id: string
          p_event: string
          p_org_id: string
          p_reason: string
          p_recipient_id: string
          p_request_id: string
        }
        Returns: {
          module_key: string
          needs_download: boolean
          outcome: string
          request_id: string
        }[]
      }
      apply_sms_delivery_event: {
        Args: {
          p_error_code: string
          p_org_id: string
          p_provider_msg_id: number
          p_status: string
        }
        Returns: string
      }
      appointment_messages_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: Json
      }
      archive_client: { Args: { p_id: string }; Returns: undefined }
      archive_template_version: { Args: { p_id: string }; Returns: undefined }
      assign_demande: {
        Args: { p_assignee: string; p_id: string }
        Returns: undefined
      }
      assign_demande_task: {
        Args: { p_assigned_to: string; p_demande_id: string; p_task_id: string }
        Returns: undefined
      }
      attach_professional_document: {
        Args: {
          p_expires_on?: string
          p_file_id: string
          p_id: string
          p_metadata?: Json
          p_type_key: string
        }
        Returns: string
      }
      attach_professional_invoice: {
        Args: {
          p_file_id: string
          p_issued_on: string
          p_number: string
          p_period_id: string
        }
        Returns: string
      }
      begin_billing_checkout_for_service: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      begin_signature_request_send: {
        Args: { p_id: string; p_org_id: string; p_stale_after: string }
        Returns: boolean
      }
      begin_stripe_charge_for_service: {
        Args: {
          p_actor: string
          p_invoice_id: string
          p_kind: string
          p_org_id: string
        }
        Returns: Json
      }
      billing_deliveries_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: string[]
      }
      billing_document_for_service: {
        Args: { p_delivery_id: string; p_org_id: string }
        Returns: Json
      }
      billing_policy_on: {
        Args: { p_on: string }
        Returns: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          fee_mode: string
          file_opening_service_id: string | null
          first_fee_percent: number
          id: string
          late_notice_hours: number
          next_fee_percent: number
          org_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "billing_policies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      billing_sync_events_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          attempts: number
          created_at: string
          entity_id: string
          id: number
          invoice_id: string
          kind: string
        }[]
      }
      book_appointment: {
        Args: {
          p_balance_override_reason?: string
          p_client_ids: string[]
          p_client_message?: string
          p_internal_note?: string
          p_mode?: string
          p_outside_availability_reason?: string
          p_professional_id: string
          p_service_id: string
          p_starts_at: string
        }
        Returns: string
      }
      book_discovery_call_for_service: {
        Args: { p_org_id: string; p_payload: Json; p_token_hash: string }
        Returns: Json
      }
      book_personal_appointment: {
        Args: {
          p_ends_at: string
          p_is_work?: boolean
          p_label: string
          p_starts_at: string
        }
        Returns: string
      }
      build_payout_month: { Args: { p_month: string }; Returns: Json }
      cancel_appointment: {
        Args: {
          p_details?: string
          p_id: string
          p_kept_on_schedule?: boolean
          p_reason_key: string
        }
        Returns: undefined
      }
      cancel_client_consent_campaign: {
        Args: { p_id: string }
        Returns: undefined
      }
      cancel_client_consent_request: {
        Args: { p_id: string }
        Returns: undefined
      }
      cancel_demande_task: {
        Args: { p_demande_id: string; p_task_id: string }
        Returns: undefined
      }
      cancel_discovery_call_for_service: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      cancel_professional_submission: {
        Args: { p_submission_id: string }
        Returns: undefined
      }
      cancel_series_from: {
        Args: {
          p_details?: string
          p_id: string
          p_kept_on_schedule?: boolean
          p_reason_key: string
        }
        Returns: number
      }
      cancel_signature_request: {
        Args: { p_by: string; p_id: string }
        Returns: boolean
      }
      change_appointment_service: {
        Args: {
          p_id: string
          p_outside_availability_reason?: string
          p_service_id: string
        }
        Returns: undefined
      }
      claim_sms_batch_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          body: string
          id: string
          kind: string
          request_id: string
          to_e164: string
        }[]
      }
      claim_video_tasks_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          appointment_id: string
          attempts: number
          ends_at: string
          generation: number
          meeting_connection_id: string
          meeting_connection_state: string
          meeting_external_id: string
          meeting_join_url: string
          meeting_professional_id: string
          professional_id: string
          started: boolean
          starts_at: string
          target_connection_id: string
          timezone: string
          wants_video: boolean
        }[]
      }
      claim_webhook_event: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_lease_seconds?: number
          p_org_id: string
          p_payload: Json
          p_provider: string
        }
        Returns: {
          claim_token: string
          id: string
          status: string
        }[]
      }
      clear_permission_override: {
        Args: { p_permission_key: string; p_user_id: string }
        Returns: undefined
      }
      clear_permission_overrides: {
        Args: { p_user_id: string }
        Returns: number
      }
      clear_professional_private_field: {
        Args: { p_field: string; p_id: string }
        Returns: undefined
      }
      client_consent_campaign_batch_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: Json
      }
      client_consent_reminders_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: Json
      }
      complete_demande_task: {
        Args: { p_demande_id: string; p_outcome: string; p_task_id: string }
        Returns: undefined
      }
      complete_mail_send: {
        Args: {
          p_error_code?: string
          p_gmail_message_id?: string
          p_gmail_thread_id?: string
          p_org_id: string
          p_send_id: string
          p_status: string
        }
        Returns: string
      }
      complete_signature_request: {
        Args: {
          p_id: string
          p_signed_file_id: string
          p_signed_sha256: string
        }
        Returns: undefined
      }
      complete_video_task_for_service: {
        Args: {
          p_appointment_id: string
          p_connection_id: string
          p_error_code: string
          p_external_id: string
          p_generation: number
          p_join_url: string
          p_org_id: string
        }
        Returns: boolean
      }
      complete_webhook_event: {
        Args: { p_claim_token: string; p_id: string }
        Returns: boolean
      }
      confirm_appointment: { Args: { p_id: string }; Returns: string }
      confirm_appointment_by_link_for_service: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      confirm_stored_file: {
        Args: { p_file_id: string; p_sha256: string; p_size_bytes: number }
        Returns: undefined
      }
      consume_rate_limit: {
        Args: {
          p_bucket: string
          p_key_hash: string
          p_max: number
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          hits: number
          retry_after_seconds: number
        }[]
      }
      copy_professional_invitation_link: {
        Args: { p_actor: string; p_id: string; p_token_hash: string }
        Returns: Json
      }
      count_my_unread_notifications: {
        Args: never
        Returns: {
          important: number
          total: number
        }[]
      }
      create_client: {
        Args: { p_client: Json; p_confirm_medium?: boolean }
        Returns: string
      }
      create_demande: { Args: { p_data: Json }; Returns: string }
      create_document_template: {
        Args: {
          p_description: string
          p_edit_permission: string
          p_key: string
          p_module_key: string
          p_title: string
          p_view_permission: string
        }
        Returns: string
      }
      create_invoice: {
        Args: {
          p_appointment_ids: string[]
          p_file_opening?: boolean
          p_notes_client?: string
          p_notes_internal?: string
          p_payer_client_id?: string
        }
        Returns: string
      }
      create_manual_invoice: {
        Args: { p_client_id: string; p_payer_client_id?: string }
        Returns: string
      }
      create_notification: {
        Args: {
          p_body: string
          p_dedupe_key?: string
          p_expires_at?: string
          p_importance: string
          p_kind: string
          p_link_path: string
          p_module_key: string
          p_org_id: string
          p_recipient_permission: string
          p_recipient_user_id?: string
          p_subject_id: string
          p_subject_type: string
          p_title: string
        }
        Returns: string
      }
      create_payer_invoice: {
        Args: { p_client_payer_id: string }
        Returns: string
      }
      create_pending_upload: {
        Args: {
          p_mime_type: string
          p_original_name: string
          p_purpose: string
          p_size_bytes: number
          p_subject_id: string
          p_subject_type: string
        }
        Returns: {
          bucket: string
          file_id: string
          object_path: string
        }[]
      }
      create_professional: {
        Args: {
          p_email: string
          p_first_name: string
          p_last_name: string
          p_licence_number?: string
          p_profession_title_id?: string
        }
        Returns: string
      }
      create_professional_invitation: {
        Args: { p_actor: string; p_id: string; p_token_hash: string }
        Returns: Json
      }
      create_proposition_for_service: {
        Args: {
          p_actor: string
          p_demande_id: string
          p_mode: string
          p_professional_id: string
          p_service_id: string
          p_starts_at: string[]
          p_token_hash: string
        }
        Returns: Json
      }
      create_role: {
        Args: { p_copy_from?: string; p_name: string }
        Returns: string
      }
      create_series: {
        Args: {
          p_balance_override_reason?: string
          p_client_ids: string[]
          p_client_message?: string
          p_count: number
          p_first_starts_at: string
          p_internal_note?: string
          p_interval_weeks: number
          p_mode?: string
          p_outside_availability_reason?: string
          p_professional_id: string
          p_service_id: string
          p_skip_conflicts?: boolean
          p_until: string
          p_weekdays: number[]
        }
        Returns: string
      }
      create_signature_request: {
        Args: { p: Json }
        Returns: {
          created_at: string
          envelope_id: string
          existing: boolean
          id: string
          last_error: string
          signers: Json
          status: string
        }[]
      }
      create_staff_invitation: {
        Args: {
          p_actor: string
          p_display_name: string
          p_email: string
          p_role: string
          p_token_hash: string
        }
        Returns: {
          expires_at: string
          id: string
        }[]
      }
      create_statement: {
        Args: {
          p_client_id: string
          p_payer_client_id?: string
          p_send?: boolean
          p_year: number
        }
        Returns: string
      }
      create_template_version: {
        Args: { p_template_id: string }
        Returns: string
      }
      deactivate_professional: {
        Args: { p_id: string; p_note?: string; p_reason_id: string }
        Returns: {
          account_change: string
          profile_id: string
          status: string
        }[]
      }
      decide_cancellation_fee: {
        Args: { p_apply: boolean; p_appointment_id: string; p_note?: string }
        Returns: string
      }
      decide_qbo_customer_match: {
        Args: { p_client_id?: string; p_decision: string; p_qbo_id: string }
        Returns: string
      }
      decide_retention: {
        Args: {
          p_count_month: string
          p_decision: string
          p_effective_from: string
          p_expected_open_id: string
          p_id: string
          p_note: string
          p_retention_pct: number
        }
        Returns: Json
      }
      delete_availability_rule: { Args: { p_id: string }; Returns: undefined }
      delete_billing_policy: { Args: { p_id: string }; Returns: undefined }
      delete_client_insurance: {
        Args: { p_client_id: string; p_rank: number }
        Returns: undefined
      }
      delete_compensation_rate: { Args: { p_id: string }; Returns: undefined }
      delete_invoice_draft: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      delete_mail_draft: { Args: { p_id: string }; Returns: undefined }
      delete_mail_messages: {
        Args: {
          p_connection_id: string
          p_gmail_message_ids: string[]
          p_org_id: string
        }
        Returns: number
      }
      delete_mail_template: { Args: { p_id: string }; Returns: undefined }
      delete_org_secret: { Args: { p_key: string }; Returns: undefined }
      delete_professional_client_agreement: {
        Args: { p_row_id: string }
        Returns: undefined
      }
      delete_professional_document: {
        Args: { p_doc_id: string }
        Returns: undefined
      }
      delete_professional_retention: {
        Args: { p_row_id: string }
        Returns: undefined
      }
      delete_retention_grid: { Args: { p_id: string }; Returns: undefined }
      delete_role: { Args: { p_role: string }; Returns: undefined }
      delete_staff_account: { Args: { p_user_id: string }; Returns: string }
      delete_tax_rate: { Args: { p_id: string }; Returns: undefined }
      delete_user_preference: {
        Args: { p_key: string; p_user_id: string }
        Returns: undefined
      }
      demande_consents: { Args: { p_id: string }; Returns: Json }
      demande_next_slots: { Args: { p_demande_id: string }; Returns: Json }
      demandes_booking_page_for_service: {
        Args: { p_org_id: string }
        Returns: Json
      }
      demandes_counts: {
        Args: never
        Returns: {
          due: number
          late: number
          mine: number
          no_answer: number
          open: number
          unassigned: number
          waitlist: number
        }[]
      }
      discard_billing_file_for_service: {
        Args: { p_file_id: string; p_org_id: string }
        Returns: undefined
      }
      discard_consent_draft: { Args: { p_id: string }; Returns: undefined }
      discard_payout_drafts: { Args: { p_month: string }; Returns: number }
      discard_system_file: {
        Args: { p_file_id: string; p_org_id: string }
        Returns: boolean
      }
      disconnect_mail_connection: {
        Args: { p_actor: string; p_connection_id: string; p_org_id: string }
        Returns: boolean
      }
      disconnect_my_calendar_connection: {
        Args: { p_actor: string; p_org_id: string }
        Returns: boolean
      }
      disconnect_my_zoom_connection: {
        Args: { p_actor: string; p_org_id: string }
        Returns: boolean
      }
      disconnect_qbo_connection: {
        Args: { p_actor: string; p_org_id: string }
        Returns: boolean
      }
      end_client_payer: { Args: { p_id: string }; Returns: undefined }
      end_professional_client_agreement: {
        Args: { p_effective_to: string; p_row_id: string }
        Returns: undefined
      }
      end_service_rate_variant: {
        Args: { p_effective_to: string; p_id: string }
        Returns: undefined
      }
      exit_waitlist: {
        Args: { p_id: string; p_professional_id?: string; p_reason: string }
        Returns: undefined
      }
      expire_signature_request: { Args: { p_id: string }; Returns: boolean }
      export_client_privacy: { Args: { p_id: string }; Returns: Json }
      fail_webhook_event: {
        Args: { p_claim_token: string; p_error: string; p_id: string }
        Returns: boolean
      }
      finalize_invoice: { Args: { p_invoice_id: string }; Returns: string }
      find_client_duplicates: {
        Args: {
          p_birthday: string
          p_email: string
          p_exclude?: string
          p_first: string
          p_last: string
          p_phones: string[]
        }
        Returns: {
          birthday: string
          client_id: string
          client_number: number
          display_name: string
          email: string
          is_archived: boolean
          level: string
          mobile_e164: string
          reasons: string[]
        }[]
      }
      finish_appointment_message_for_service: {
        Args: {
          p_message_id: string
          p_org_id: string
          p_sent: boolean
          p_skip_reason?: string
        }
        Returns: undefined
      }
      finish_billing_delivery_for_service: {
        Args: {
          p_delivery_id: string
          p_email_log_id: string
          p_email_status: string
          p_error: string
          p_file_id: string
          p_org_id: string
          p_skip_reason: string
        }
        Returns: undefined
      }
      finish_billing_sync_event_for_service: {
        Args: { p_error_code: string; p_id: number; p_org_id: string }
        Returns: undefined
      }
      finish_client_consent_campaign_item_for_service: {
        Args: {
          p_failure?: string
          p_item_id: string
          p_org_id: string
          p_request_id?: string
          p_sent: boolean
        }
        Returns: undefined
      }
      finish_job_run: {
        Args: { p_detail: string; p_id: string; p_status: string }
        Returns: undefined
      }
      finish_mail_sync: {
        Args: {
          p_connection_id: string
          p_error_code: string
          p_history_id: number
          p_initial_sync_done: boolean
          p_initial_sync_page_token: string
          p_messages: number
          p_org_id: string
          p_status: string
          p_token: string
        }
        Returns: boolean
      }
      finish_qbo_sync: {
        Args: {
          p_accounts_synced: boolean
          p_company_name: string
          p_customers_synced: boolean
          p_error_code: string
          p_org_id: string
          p_status: string
        }
        Returns: undefined
      }
      finish_refund_for_service: {
        Args: {
          p_error_code: string
          p_ok: boolean
          p_org_id: string
          p_provider_ref: string
          p_refund_id: string
        }
        Returns: undefined
      }
      finish_stripe_charge_for_service: {
        Args: {
          p_charge_id: string
          p_failure_code: string
          p_org_id: string
          p_payment_intent_id: string
          p_status: string
        }
        Returns: Json
      }
      get_ai_draft_status: { Args: never; Returns: Json }
      get_ai_settings: { Args: never; Returns: Json }
      get_appointment_consents: {
        Args: { p_appointment_id: string }
        Returns: {
          client_id: string
          consent_key: string
          consent_name: string
          frequency: string
          state: string
        }[]
      }
      get_appointment_video: {
        Args: { p_appointment_id: string }
        Returns: {
          source: string
          status: string
          url: string
        }[]
      }
      get_bank_details: {
        Args: never
        Returns: {
          account_last4: string
          etransfer_email: string
          institution_number: string
          transit_number: string
          updated_at: string
          updated_by_name: string
        }[]
      }
      get_billing_document: {
        Args: { p_id: string; p_kind: string }
        Returns: Json
      }
      get_billing_settings: { Args: never; Returns: Json }
      get_booking_consents: {
        Args: { p_client_ids: string[]; p_service_id: string }
        Returns: {
          client_id: string
          consent_key: string
          consent_name: string
          frequency: string
          state: string
        }[]
      }
      get_calendar_credentials_for_service: {
        Args: { p_connection_id: string; p_org_id: string }
        Returns: {
          access_token: string
          access_token_expires_at: string
          connected_at: string
          professional_id: string
          refresh_token: string
          state: string
        }[]
      }
      get_client_billing: { Args: { p_client_id: string }; Returns: Json }
      get_client_consent_clauses: {
        Args: { p_version_id: string }
        Returns: Json
      }
      get_client_payers_billing: {
        Args: { p_client_id: string }
        Returns: Json
      }
      get_client_stripe: { Args: { p_client_id: string }; Returns: Json }
      get_client_summary: { Args: { p_id: string }; Returns: Json }
      get_communications_settings: { Args: never; Returns: Json }
      get_communications_settings_for_org: {
        Args: { p_org_id: string }
        Returns: Json
      }
      get_consent_versions: { Args: { p_key?: string }; Returns: Json }
      get_demande: { Args: { p_id: string }; Returns: Json }
      get_demandes_booking_settings: { Args: never; Returns: Json }
      get_demandes_reference: { Args: never; Returns: Json }
      get_demandes_waitlist_settings: { Args: never; Returns: Json }
      get_email_context: {
        Args: { p_org_id: string; p_template_key: string }
        Returns: Json
      }
      get_invoice: { Args: { p_invoice_id: string }; Returns: Json }
      get_mail_compose_context: { Args: { p_client_id: string }; Returns: Json }
      get_mail_connection_credentials: {
        Args: { p_connection_id: string; p_org_id: string }
        Returns: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          email_address: string
          kind: string
          refresh_token: string
          scopes: string[]
          status: string
        }[]
      }
      get_mail_draft: { Args: { p_id: string }; Returns: Json }
      get_mail_thread: { Args: { p_thread_id: string }; Returns: Json }
      get_mail_thread_link: { Args: { p_thread_id: string }; Returns: Json }
      get_mail_threads_for_action: {
        Args: { p_actor: string; p_org_id: string; p_thread_ids: string[] }
        Returns: {
          connection_id: string
          gmail_thread_id: string
          messages: Json
          thread_id: string
        }[]
      }
      get_my_access: { Args: never; Returns: Json }
      get_my_agenda_reference: { Args: never; Returns: Json }
      get_my_calendar_credentials_for_service: {
        Args: { p_actor: string; p_org_id: string }
        Returns: {
          access_token: string
          access_token_expires_at: string
          connected_at: string
          connection_id: string
          refresh_token: string
          state: string
        }[]
      }
      get_my_calendar_setup: {
        Args: never
        Returns: {
          account_email: string
          busy_count: number
          connected_at: string
          last_sync_error: string
          last_synced_at: string
          professional_id: string
          reconnect_reason: string
          state: string
        }[]
      }
      get_my_image_consent: { Args: never; Returns: Json }
      get_my_professional_private: {
        Args: never
        Returns: {
          bank_account_last4: string
          bank_institution: string
          bank_transit: string
          business_number: string
          gst_number: string
          qst_number: string
          sin_last3: string
          updated_at: string
        }[]
      }
      get_my_professional_record: { Args: never; Returns: Json }
      get_my_submission: { Args: never; Returns: Json }
      get_my_video_setup: {
        Args: never
        Returns: {
          fixed_url: string
          professional_id: string
          zoom_connected_at: string
          zoom_email: string
          zoom_reconnect_reason: string
          zoom_state: string
        }[]
      }
      get_my_zoom_credentials_for_service: {
        Args: { p_actor: string; p_org_id: string }
        Returns: {
          access_token: string
          connection_id: string
          refresh_token: string
        }[]
      }
      get_open_slots: {
        Args: {
          p_from: string
          p_professional_id: string
          p_service_id: string
          p_to: string
        }
        Returns: {
          ends_at: string
          starts_at: string
        }[]
      }
      get_org_secret: {
        Args: { p_key: string; p_org_id: string }
        Returns: string
      }
      get_payer_settings: { Args: never; Returns: Json }
      get_payout_period: { Args: { p_id: string }; Returns: Json }
      get_pending_upload: {
        Args: { p_file_id: string }
        Returns: {
          bucket: string
          max_bytes: number
          max_image_side: number
          mime_type: string
          object_path: string
          size_bytes: number
        }[]
      }
      get_professional_account_status: {
        Args: { p_id: string }
        Returns: {
          account_status: string
          profile_id: string
        }[]
      }
      get_professional_compensation: {
        Args: { p_id: string; p_on?: string }
        Returns: Json
      }
      get_professional_contract: { Args: { p_id: string }; Returns: Json }
      get_professional_document_rejection_for_service: {
        Args: { p_actor: string; p_doc_id: string }
        Returns: Json
      }
      get_professional_documents: { Args: { p_id?: string }; Returns: Json }
      get_professional_fiche_upload: {
        Args: { p_file_id: string; p_id: string }
        Returns: Json
      }
      get_professional_image_consent: { Args: { p_id: string }; Returns: Json }
      get_professional_onboarding: { Args: { p_id: string }; Returns: Json }
      get_professional_private: {
        Args: { p_id: string }
        Returns: {
          bank_account_last4: string
          bank_institution: string
          bank_transit: string
          business_number: string
          gst_number: string
          qst_number: string
          sin_last3: string
          updated_at: string
          updated_by_name: string
        }[]
      }
      get_professional_public_fees: {
        Args: { p_id: string; p_title_id?: string }
        Returns: Json
      }
      get_professional_public_profile: { Args: { p_id: string }; Returns: Json }
      get_professional_readiness: { Args: { p_id: string }; Returns: Json }
      get_professional_record: { Args: { p_id: string }; Returns: Json }
      get_professional_submission_notice_for_service: {
        Args: { p_actor: string }
        Returns: Json
      }
      get_professionals_catalog: { Args: never; Returns: Json }
      get_professionals_settings: { Args: never; Returns: Json }
      get_qbo_credentials: {
        Args: { p_org_id: string }
        Returns: {
          access_token: string
          access_token_expires_at: string
          connection_id: string
          environment: string
          realm_id: string
          refresh_token: string
          status: string
        }[]
      }
      get_qbo_settings: { Args: never; Returns: Json }
      get_service_price: {
        Args: {
          p_on: string
          p_service_id: string
          p_tax_exempt?: boolean
          p_title_id: string
          p_variant: string
        }
        Returns: {
          price_cents: number
          source: string
          tax_rule: string
          variant_applied: boolean
        }[]
      }
      get_signature_request: {
        Args: { p_id: string }
        Returns: {
          completed_at: string
          envelope_id: string
          expires_at: string
          id: string
          last_error: string
          module_key: string
          org_id: string
          purpose: string
          sent_at: string
          status: string
          subject_id: string
          subject_type: string
          title: string
        }[]
      }
      get_signing_context: {
        Args: { p_org_id: string; p_template_version_id: string }
        Returns: Json
      }
      get_signing_credentials: {
        Args: { p_org_id: string }
        Returns: {
          api_key: string
          base_url: string
          expiry_days: number
        }[]
      }
      get_signing_request: {
        Args: { p_id: string; p_org_id: string }
        Returns: Json
      }
      get_sms_provider_context: { Args: { p_org_id: string }; Returns: Json }
      get_sms_settings: { Args: never; Returns: Json }
      get_sms_thread_link: { Args: { p_phone: string }; Returns: Json }
      get_submission_review: {
        Args: { p_submission_id: string }
        Returns: Json
      }
      get_waitlist_entry: { Args: { p_id: string }; Returns: Json }
      get_zoom_credentials_for_service: {
        Args: { p_connection_id: string; p_org_id: string }
        Returns: {
          access_token: string
          access_token_expires_at: string
          connected_at: string
          refresh_token: string
          state: string
        }[]
      }
      hold_invoice_draft: {
        Args: { p_invoice_id: string; p_note?: string }
        Returns: undefined
      }
      ignore_interac_notice: {
        Args: { p_notice_id: string; p_reason: string }
        Returns: undefined
      }
      import_appointment: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      import_client: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      import_client_consent: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      import_client_consent_fact_for_service: {
        Args: {
          p_client_id: string
          p_consent_key: string
          p_org_id: string
          p_signed_at: string
          p_signer_name: string
          p_version_label: string
        }
        Returns: boolean
      }
      import_client_payers: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      import_client_relation: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      import_default_payer: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      import_invoice: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      import_professional: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      import_waitlist_entry: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      invoice_waitlist_fee: { Args: { p_entry_id: string }; Returns: string }
      issue_billing_link_for_service: {
        Args: {
          p_actor: string
          p_org_id: string
          p_purpose: string
          p_subject_id: string
          p_token_hash: string
        }
        Returns: boolean
      }
      issue_credit_note: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: string
      }
      jobs_health_report: { Args: never; Returns: Json }
      last_webhook_event_at: { Args: { p_provider: string }; Returns: string }
      link_mail_thread: {
        Args: { p_client_id: string; p_thread_id: string }
        Returns: undefined
      }
      link_professional_account: {
        Args: { p_payload: Json; p_token_hash: string; p_user_id: string }
        Returns: Json
      }
      link_sms_thread: {
        Args: { p_client_id: string; p_phone: string }
        Returns: undefined
      }
      list_agenda: {
        Args: { p_from: string; p_professional_ids?: string[]; p_to: string }
        Returns: {
          balance_override: boolean
          blocks_until: string
          cancel_late: boolean
          cancel_reason_id: string
          confirmed_at: string
          ends_at: string
          id: string
          is_personal: boolean
          kept_on_schedule: boolean
          mode: string
          outside_availability: boolean
          participants: Json
          personal_label: string
          professional_id: string
          series_id: string
          service_id: string
          starts_at: string
          state: string
          video_status: string
          video_url: string
        }[]
      }
      list_appointment_history: {
        Args: { p_before_id?: number; p_id: string; p_limit?: number }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          actor_role: string
          changed_fields: Json
          created_at: string
          id: number
          record_id: string
          source: string
          table_name: string
        }[]
      }
      list_appointments_without_reminder: {
        Args: { p_from: string; p_to: string }
        Returns: {
          id: string
          participants: Json
          professional_id: string
          starts_at: string
          state: string
        }[]
      }
      list_audit_actors: {
        Args: never
        Returns: {
          actor_id: string
          actor_name: string
        }[]
      }
      list_audit_entries: {
        Args: {
          p_actor?: string
          p_before_id?: number
          p_from?: string
          p_limit?: number
          p_table?: string
          p_to?: string
        }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          actor_role: string
          changed_fields: Json
          created_at: string
          id: number
          record_id: string
          source: string
          table_name: string
        }[]
      }
      list_calendar_connections_to_sync_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: string[]
      }
      list_client_demandes: { Args: { p_client_id: string }; Returns: Json }
      list_client_history: {
        Args: { p_before_id?: number; p_id: string; p_limit?: number }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          actor_role: string
          changed_fields: Json
          created_at: string
          id: number
          record_id: string
          source: string
          table_name: string
        }[]
      }
      list_client_mail_threads: {
        Args: { p_client_id: string }
        Returns: {
          connection_id: string
          id: string
          last_from_address: string
          last_from_name: string
          last_message_at: string
          link_source: string
          message_count: number
          snippet: string
          subject: string
          unread_count: number
        }[]
      }
      list_client_payers_to_complete: { Args: never; Returns: Json }
      list_client_sms: {
        Args: { p_client_id: string }
        Returns: {
          consent_status: string
          kind: string
          last_message_at: string
          link_status: string
          message_count: number
          phone: string
        }[]
      }
      list_client_visits: {
        Args: { p_before?: string; p_client_id: string; p_limit?: number }
        Returns: {
          cancel_late: boolean
          cancel_reason: string
          confirmed_at: string
          ends_at: string
          id: string
          kept_on_schedule: boolean
          mode: string
          presence: string
          professional_id: string
          professional_name: string
          role: string
          service_code: number
          service_id: string
          service_name: string
          starts_at: string
          state: string
        }[]
      }
      list_clients: {
        Args: {
          p_after_first?: string
          p_after_id?: string
          p_after_last?: string
          p_after_visit?: string
          p_last_visit?: string
          p_limit?: number
          p_professional_id?: string
          p_query?: string
          p_sort?: string
          p_status?: string
          p_tag_id?: string
        }
        Returns: {
          birthday: string
          client_number: number
          email: string
          file_incomplete: boolean
          first_name: string
          id: string
          is_archived: boolean
          is_banned: boolean
          last_name: string
          last_visit_at: string
          mobile_e164: string
          primary_professional_id: string
          rate_variant: string
          sort_first: string
          sort_last: string
          sort_visit: string
          special_agreement: boolean
          tag_ids: string[]
          tax_exempt: boolean
        }[]
      }
      list_demande_propositions: {
        Args: { p_demande_id: string }
        Returns: {
          accepted_starts_at: string
          decline_reason: string
          expires_at: string
          id: string
          mode: string
          professional_id: string
          professional_name: string
          proposed_at: string
          proposed_by_name: string
          responded_at: string
          response: string
          service_name: string
          slots: Json
        }[]
      }
      list_demandes: {
        Args: {
          p_assigned?: string
          p_flags?: string[]
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort?: string
          p_view?: string
        }
        Returns: {
          assigned_name: string
          assigned_to: string
          beneficiary: string
          channel: string
          client_id: string
          client_number: number
          contact_attempts: number
          first_contact_at: string
          handled_at: string
          handled_by: string
          handled_by_name: string
          id: string
          is_urgent: boolean
          last_contact_at: string
          last_outcome: string
          motif_count: number
          next_contact_at: string
          next_task_due: string
          no_answer: boolean
          open_tasks: number
          person_name: string
          promise: string
          received_at: string
          reference: string
          state: string
          waiting_hours: number
        }[]
      }
      list_discovery_calls: {
        Args: { p_from: string; p_overdue?: boolean; p_to: string }
        Returns: {
          assigned_name: string
          assigned_to: string
          booked_online: boolean
          demande_id: string
          demande_state: string
          done_at: string
          done_by_name: string
          due_at: string
          is_urgent: boolean
          language: string
          outcome: string
          person_name: string
          phone_e164: string
          reference: string
          state: string
          task_id: string
        }[]
      }
      list_document_template_versions: {
        Args: { p_template_id: string }
        Returns: {
          archived_at: string
          body: Json
          created_at: string
          email_message: string
          email_subject: string
          id: string
          published_at: string
          signers: Json
          status: string
          updated_at: string
          variables: Json
          version: number
        }[]
      }
      list_document_templates: {
        Args: { p_module_key?: string }
        Returns: {
          can_edit: boolean
          description: string
          draft_version_id: string
          edit_permission: string
          id: string
          is_active: boolean
          key: string
          module_key: string
          published_at: string
          published_version: number
          published_version_id: string
          title: string
          updated_at: string
          view_permission: string
        }[]
      }
      list_email_log: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_from?: string
          p_limit?: number
          p_status?: string
          p_template_key?: string
          p_to?: string
        }
        Returns: {
          created_at: string
          error_code: string
          id: string
          last_event_at: string
          sent_at: string
          status: string
          subject_id: string
          subject_type: string
          template_key: string
          template_label: string
          to_email: string
        }[]
      }
      list_email_templates: {
        Args: never
        Returns: {
          body: string
          button_label: string
          description: string
          is_custom: boolean
          key: string
          label: string
          module_key: string
          subject: string
          updated_at: string
          updated_by_name: string
          variables: Json
          version: number
        }[]
      }
      list_external_busy: {
        Args: { p_from: string; p_professional_ids?: string[]; p_to: string }
        Returns: {
          ends_at: string
          professional_id: string
          starts_at: string
        }[]
      }
      list_fee_decisions: { Args: { p_status?: string }; Returns: Json }
      list_files_to_purge: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          bucket: string
          id: string
          object_path: string
        }[]
      }
      list_interac_notices: {
        Args: { p_limit?: number; p_status?: string }
        Returns: Json
      }
      list_invoices: {
        Args: {
          p_before?: string
          p_client_id?: string
          p_limit?: number
          p_status?: string
        }
        Returns: {
          client_id: string
          client_name: string
          client_number: number
          created_at: string
          id: string
          issued_on: string
          number: string
          paid_cents: number
          payer_client_id: string
          payer_kind: string
          payer_name: string
          payment_status: string
          status: string
          total_cents: number
        }[]
      }
      list_job_orgs: { Args: { p_key: string }; Returns: string[] }
      list_mail_attachments_to_store: {
        Args: { p_connection_id: string; p_limit?: number; p_org_id: string }
        Returns: {
          attachment_id: string
          attempts: number
          filename: string
          gmail_attachment_id: string
          gmail_message_id: string
          message_id: string
          mime_type: string
          part_id: string
          size_bytes: number
        }[]
      }
      list_mail_compose_templates: {
        Args: never
        Returns: {
          body: string
          format: string
          id: string
          kind: string
          name: string
          subject: string
        }[]
      }
      list_mail_connections: {
        Args: never
        Returns: {
          connected_at: string
          connected_by_name: string
          disconnected_at: string
          email_address: string
          id: string
          initial_sync_done: boolean
          kind: string
          last_error_at: string
          last_error_code: string
          last_sync_at: string
          last_sync_status: string
          messages_synced: number
          scopes: string[]
          status: string
          status_reason: string
          sync_in_progress: boolean
          thread_count: number
          unread_count: number
          watch_expires_at: string
        }[]
      }
      list_mail_connections_to_sync: {
        Args: { p_org_id: string }
        Returns: {
          connection_id: string
          email_address: string
          history_id: number
          initial_sync_done: boolean
          initial_sync_page_token: string
          last_sync_at: string
          lease_until: string
          status: string
          sync_requested_at: string
          watch_expires_at: string
        }[]
      }
      list_mail_drafts: {
        Args: never
        Returns: {
          attachment_count: number
          client_id: string
          connection_id: string
          id: string
          mode: string
          subject: string
          thread_id: string
          to_addresses: string[]
          updated_at: string
        }[]
      }
      list_mail_threads: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_connection_id: string
          p_label_id?: string
          p_limit?: number
          p_search?: string
          p_view?: string
        }
        Returns: {
          connection_id: string
          gmail_thread_id: string
          has_attachments: boolean
          id: string
          label_ids: string[]
          last_from_address: string
          last_from_name: string
          last_message_at: string
          link_status: string
          message_count: number
          snippet: string
          subject: string
          unread_count: number
        }[]
      }
      list_module_testers: {
        Args: never
        Returns: {
          module_key: string
          tester_ids: string[]
          testers_only: boolean
        }[]
      }
      list_modules: {
        Args: never
        Returns: {
          depends_on: string[]
          enabled: boolean
          key: string
          name: string
        }[]
      }
      list_morning_queue: { Args: never; Returns: Json }
      list_my_notifications: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_importance?: string
          p_limit?: number
          p_unread_only?: boolean
        }
        Returns: {
          body: string
          created_at: string
          id: string
          importance: string
          is_read: boolean
          kind: string
          link_path: string
          module_key: string
          subject_id: string
          subject_type: string
          title: string
        }[]
      }
      list_my_payout_periods: {
        Args: never
        Returns: {
          has_invoice: boolean
          id: string
          lines_count: number
          month: string
          paid_on: string
          sent_at: string
          state: string
          total_cents: number
          validated_at: string
        }[]
      }
      list_org_secret_keys: {
        Args: never
        Returns: {
          key: string
          updated_at: string
        }[]
      }
      list_org_users: {
        Args: never
        Returns: {
          display_name: string
          email: string
          last_sign_in_at: string
          override_count: number
          role: string
          role_name: string
          status: string
          user_id: string
        }[]
      }
      list_overdue_invoices: { Args: never; Returns: Json }
      list_payer_organisations: { Args: never; Returns: Json }
      list_payer_queue: { Args: never; Returns: Json }
      list_payout_export: {
        Args: { p_month: string }
        Returns: {
          amount_cents: number
          invoice_number: string
          issued_on: string
          paid_on: string
          period_id: string
          professional_name: string
          specialty: string
          state: string
        }[]
      }
      list_payout_periods: {
        Args: { p_month: string }
        Returns: {
          built_at: string
          correction_note: string
          id: string
          invoice_file_id: string
          invoice_number: string
          invoice_source: string
          lines_count: number
          paid_on: string
          professional_id: string
          professional_name: string
          sent_at: string
          state: string
          title_name: string
          total_cents: number
          unpriced_count: number
          validated_at: string
        }[]
      }
      list_payout_rules: {
        Args: never
        Returns: {
          code: number
          family_code: number
          family_name: string
          is_active: boolean
          is_default: boolean
          kind: string
          name: string
          rule: string
          service_id: string
        }[]
      }
      list_professional_capacity: { Args: never; Returns: Json }
      list_professional_history: {
        Args: { p_before_id?: number; p_id: string; p_limit?: number }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          actor_role: string
          changed_fields: Json
          created_at: string
          id: number
          record_id: string
          source: string
          table_name: string
        }[]
      }
      list_professional_invitation_states: {
        Args: never
        Returns: {
          delivery: string
          email_error: string
          email_status: string
          expires_at: string
          onboarding_approved: boolean
          opened_at: string
          professional_id: string
          sent_at: string
          state: string
          submission_id: string
          submission_kind: string
          submission_status: string
          submitted_at: string
          used_at: string
        }[]
      }
      list_professional_invitations_to_remind_for_service: {
        Args: { p_limit?: number; p_org: string }
        Returns: string[]
      }
      list_professional_submissions: { Args: { p_id: string }; Returns: Json }
      list_professional_video_status: {
        Args: never
        Returns: {
          fixed_url: string
          professional_id: string
          zoom_connected_at: string
          zoom_email: string
          zoom_reconnect_reason: string
          zoom_state: string
        }[]
      }
      list_professionals: {
        Args: {
          p_accepting_new_clients?: boolean
          p_after_first_name?: string
          p_after_id?: string
          p_after_last_name?: string
          p_after_status_changed_at?: string
          p_clientele_ids?: string[]
          p_language_ids?: string[]
          p_limit?: number
          p_motif_ids?: string[]
          p_sort?: string
          p_statuses?: string[]
          p_title_ids?: string[]
        }
        Returns: {
          accepting_new_clients: boolean | null
          clientele_ids: string[] | null
          created_at: string | null
          deactivation_reason_id: string | null
          documents_done: number | null
          documents_required: number | null
          documents_to_review: number | null
          email: string | null
          email_matches_login: boolean | null
          first_name: string | null
          gender: string | null
          has_account: boolean | null
          id: string | null
          insurance_expires_on: string | null
          insurance_status: string | null
          language_ids: string[] | null
          last_name: string | null
          matching_complete: boolean | null
          motif_ids: string[] | null
          org_id: string | null
          photo_file_id: string | null
          primary_licence_number: string | null
          primary_title_id: string | null
          ready: boolean | null
          status: string | null
          status_changed_at: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "professionals_list"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_professionals_reference_usage: {
        Args: never
        Returns: {
          id: string
          kind: string
          usage: number
        }[]
      }
      list_qbo_customer_matches: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status: string
        }
        Returns: {
          active: boolean
          candidates: Json
          client: Json
          decided_at: string
          display_name: string
          email: string
          level: string
          phones: string[]
          qbo_id: string
          reasons: string[]
          source: string
          status: string
        }[]
      }
      list_qbo_pushes: {
        Args: { p_limit?: number; p_status?: string }
        Returns: Json
      }
      list_retention_review: { Args: { p_month: string }; Returns: Json }
      list_scheduled_job_runs: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_job_key?: string
          p_limit?: number
        }
        Returns: {
          detail: string
          finished_at: string
          id: string
          job_key: string
          started_at: string
          status: string
          trigger: string
        }[]
      }
      list_scheduled_jobs: {
        Args: never
        Returns: {
          description: string
          enabled: boolean
          is_maintenance: boolean
          key: string
          kind: string
          label: string
          last_detail: string
          last_started_at: string
          last_status: string
          local_hour: number
          schedule: string
        }[]
      }
      list_service_prices: {
        Args: { p_on: string }
        Returns: {
          price_cents: number
          reduced_price_cents: number
          service_id: string
          source: string
          student_price_cents: number
          tax_rule: string
          title_id: string
        }[]
      }
      list_signature_requests_to_reconcile: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          action: string
          envelope_id: string
          expires_at: string
          id: string
          module_key: string
          status: string
        }[]
      }
      list_sms_conversations: {
        Args: { p_search?: string; p_view?: string }
        Returns: {
          client_id: string
          client_name: string
          client_number: number
          consent_status: string
          last_body: string
          last_body_purged: boolean
          last_direction: string
          last_has_media: boolean
          last_inbound_at: string
          last_message_at: string
          last_status: string
          link_source: string
          link_status: string
          message_count: number
          phone: string
        }[]
      }
      list_sms_thread: {
        Args: { p_limit?: number; p_phone: string }
        Returns: {
          body: string
          body_purged_at: string
          created_at: string
          direction: string
          error_code: string
          id: string
          kind: string
          media: Json
          peer_e164: string
          send_after: string
          sent_at: string
          status: string
        }[]
      }
      list_staff_invitations: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          expires_at: string
          id: string
          invited_by_name: string
          is_expired: boolean
          last_email_at: string
          last_email_error_code: string
          last_email_status: string
          role: string
          role_name: string
          status: string
        }[]
      }
      list_subject_emails: {
        Args: { p_limit?: number; p_subject_id: string; p_subject_type: string }
        Returns: {
          created_at: string
          error_code: string
          id: string
          last_event_at: string
          sent_at: string
          sent_by: string
          sent_by_name: string
          status: string
          template_key: string
          template_label: string
          to_email: string
        }[]
      }
      list_subject_signature_requests: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_limit?: number
          p_subject_id: string
          p_subject_type: string
        }
        Returns: {
          cancelled_at: string
          completed_at: string
          created_at: string
          expired_at: string
          expires_at: string
          id: string
          last_error: string
          module_key: string
          purpose: string
          rejected_at: string
          rejection_reason: string
          sent_at: string
          sent_by: string
          signed_file_id: string
          signers: Json
          status: string
          template_version: number
          template_version_id: string
          title: string
          viewed_at: string
        }[]
      }
      list_unverified_signature_requests: {
        Args: never
        Returns: {
          error_code: string
          failing_since: string
          id: string
          module_key: string
          sent_at: string
          synced_at: string
          title: string
        }[]
      }
      list_waitlist: {
        Args: {
          p_demande_id?: string
          p_professional_id?: string
          p_states?: string[]
          p_title_id?: string
        }
        Returns: {
          bridge_name: string
          bridge_professional_id: string
          client_id: string
          client_number: number
          consent_state: string
          demande_id: string
          exit_reason: string
          exited_at: string
          fee_status: string
          fee_waived_reason: string
          followup_unanswered: boolean
          id: string
          last_contact_at: string
          list_size: number
          next_contact_at: string
          pending_offer: boolean
          person_name: string
          priority: string
          priority_reason: string
          rank: number
          reference: string
          registered_at: string
          state: string
          target_id: string
          target_kind: string
          target_name: string
          waited_days: number
        }[]
      }
      list_waitlist_compatible: {
        Args: { p_professional_id: string }
        Returns: Json
      }
      list_zoom_connections_to_refresh_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: string[]
      }
      log_demande_contact: {
        Args: {
          p_channel: string
          p_id: string
          p_next_contact_at?: string
          p_outcome: string
        }
        Returns: number
      }
      log_waitlist_contact: {
        Args: {
          p_id: string
          p_kind: string
          p_next_contact_at?: string
          p_outcome: string
        }
        Returns: undefined
      }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_calendar_needs_reconnect_for_service: {
        Args: {
          p_connected_at: string
          p_connection_id: string
          p_org_id: string
          p_reason: string
        }
        Returns: boolean
      }
      mark_client_consent_copy_sent_for_service: {
        Args: { p_actor: string; p_consent_id: string; p_org_id: string }
        Returns: string
      }
      mark_email_failed: {
        Args: { p_attempts: number; p_error_code: string; p_id: string }
        Returns: undefined
      }
      mark_email_sent: {
        Args: { p_attempts: number; p_id: string; p_resend_id: string }
        Returns: undefined
      }
      mark_files_purged: {
        Args: { p_ids: string[]; p_org_id: string }
        Returns: number
      }
      mark_notifications_read: { Args: { p_ids: string[] }; Returns: undefined }
      mark_period_paid: {
        Args: { p_id: string; p_note?: string; p_paid_on: string }
        Returns: undefined
      }
      mark_professional_fiche_generated: {
        Args: { p_id: string }
        Returns: string
      }
      mark_signature_request_failed: {
        Args: { p_envelope_id?: string; p_error_code: string; p_id: string }
        Returns: undefined
      }
      mark_signature_request_sent: {
        Args: {
          p_envelope_id: string
          p_expires_at: string
          p_id: string
          p_page_count?: number
          p_signer_recipients: Json
          p_source_file_id: string
        }
        Returns: undefined
      }
      mark_sms_failed: {
        Args: { p_error_code: string; p_id: string; p_org_id: string }
        Returns: undefined
      }
      mark_sms_sent: {
        Args: {
          p_id: string
          p_org_id: string
          p_provider_msg_id: number
          p_provider_session_id: number
        }
        Returns: undefined
      }
      mark_video_link_emailed_for_service: {
        Args: { p_appointment_id: string; p_join_url: string; p_org_id: string }
        Returns: undefined
      }
      mark_waitlist_followup_sent_for_service: {
        Args: { p_entry_id: string; p_org_id: string; p_sent: boolean }
        Returns: undefined
      }
      mark_zoom_needs_reconnect_for_service: {
        Args: {
          p_connected_at: string
          p_connection_id: string
          p_org_id: string
          p_reason: string
        }
        Returns: boolean
      }
      match_interac_notice: {
        Args: { p_invoice_id: string; p_notice_id: string }
        Returns: string
      }
      match_professionals_for_demande: {
        Args: { p_demande_id: string }
        Returns: Json
      }
      match_qbo_customers: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: number
      }
      merge_clients: {
        Args: { p_keep: string; p_merge: string; p_take?: string[] }
        Returns: string
      }
      module_enabled: { Args: { p_key: string }; Returns: boolean }
      module_enabled_for_org: {
        Args: { p_key: string; p_org_id: string }
        Returns: boolean
      }
      module_open_to_all_for_org: {
        Args: { p_key: string; p_org_id: string }
        Returns: boolean
      }
      move_appointment: {
        Args: {
          p_id: string
          p_outside_availability_reason?: string
          p_professional_id?: string
          p_starts_at: string
        }
        Returns: undefined
      }
      open_client_consent_for_service: {
        Args: {
          p_birth_year: number
          p_first_name: string
          p_token_hash: string
        }
        Returns: Json
      }
      peek_secure_link: {
        Args: { p_mark_opened: boolean; p_token_hash: string }
        Returns: Json
      }
      pii_health_check: { Args: never; Returns: boolean }
      prepare_appointment_message_for_service: {
        Args: { p_message_id: string; p_org_id: string; p_token_hash: string }
        Returns: Json
      }
      prepare_client_consent_copy_for_service: {
        Args: { p_actor: string; p_consent_id: string; p_org_id: string }
        Returns: Json
      }
      prepare_client_consent_request_for_service: {
        Args: {
          p_actor: string
          p_client_id: string
          p_consent_key: string
          p_context_id: string
          p_context_type: string
          p_due_at: string
          p_org_id: string
          p_request_id?: string
          p_token_hash_1: string
          p_token_hash_2: string
        }
        Returns: Json
      }
      prepare_mail_send: {
        Args: { p_actor: string; p_org_id: string; p_send: Json }
        Returns: Json
      }
      prepare_my_image_consent: {
        Args: { p_action: string; p_actor: string; p_idempotency_key: string }
        Returns: Json
      }
      prepare_payer_invoices: {
        Args: { p_closing?: boolean; p_organisation_id?: string }
        Returns: string[]
      }
      prepare_professional_contract: {
        Args: {
          p_action: string
          p_actor: string
          p_id: string
          p_idempotency_key: string
        }
        Returns: Json
      }
      prepare_professional_image_consent: {
        Args: {
          p_action: string
          p_actor: string
          p_id: string
          p_idempotency_key: string
        }
        Returns: Json
      }
      prepare_professional_invoice: {
        Args: { p_actor: string; p_period_id: string }
        Returns: Json
      }
      prepare_qbo_push_for_service: {
        Args: {
          p_entity: string
          p_invoice: string
          p_kind: string
          p_org_id: string
        }
        Returns: Json
      }
      prepare_waitlist_followup_for_service: {
        Args: { p_entry_id: string; p_org_id: string; p_token_hash: string }
        Returns: Json
      }
      preview_series: {
        Args: {
          p_count?: number
          p_first_starts_at: string
          p_interval_weeks: number
          p_professional_id: string
          p_service_id: string
          p_until?: string
          p_weekdays: number[]
        }
        Returns: {
          conflict: string
          ends_at: string
          occurrence: number
          starts_at: string
        }[]
      }
      proposition_services: {
        Args: { p_professional_id: string }
        Returns: {
          code: number
          duration_minutes: number
          for_two: boolean
          id: string
          name: string
        }[]
      }
      prune_qbo_customers: {
        Args: { p_org_id: string; p_sync_started_at: string }
        Returns: number
      }
      publish_client_consent_version: {
        Args: { p_population: string; p_version_id: string }
        Returns: number
      }
      publish_consent_version: { Args: { p_id: string }; Returns: undefined }
      publish_template_version: { Args: { p_id: string }; Returns: undefined }
      qbo_bills_to_push_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          amount_cents: number
          attempts: number
          expense_account_id: string
          invoice_id: string
          issued_on: string
          number: string
          professional_id: string
          professional_name: string
          title_name: string
          vendor_id: string
        }[]
      }
      qbo_customer_match_counts: {
        Args: never
        Returns: {
          customers: number
          status: string
        }[]
      }
      qbo_invoice_push_status: { Args: { p_invoice_id: string }; Returns: Json }
      qbo_push_state_for_service: { Args: { p_org_id: string }; Returns: Json }
      queue_email: {
        Args: {
          p_attachment_count: number
          p_org_id: string
          p_sent_by: string
          p_subject_id: string
          p_subject_type: string
          p_template_key: string
          p_template_version: number
          p_to_email: string
          p_to_profile_id: string
          p_view_permission: string
        }
        Returns: string
      }
      queue_sms_for_service: {
        Args: {
          p_actor: string
          p_body: string
          p_kind: string
          p_org_id: string
          p_to: string
        }
        Returns: Json
      }
      rebuild_payout_period: { Args: { p_id: string }; Returns: Json }
      record_ai_request_for_service: {
        Args: {
          p_actor: string
          p_completion_tokens: number
          p_cost_cents: number
          p_error_code: string
          p_kind: string
          p_model: string
          p_org_id: string
          p_prompt_tokens: number
          p_status: string
        }
        Returns: string
      }
      record_calendar_sync_error_for_service: {
        Args: { p_connection_id: string; p_error: string; p_org_id: string }
        Returns: undefined
      }
      record_generated_professional_invoice: {
        Args: {
          p_actor: string
          p_file_id: string
          p_issued_on: string
          p_number: string
          p_period_id: string
        }
        Returns: string
      }
      record_inbound_sms: {
        Args: {
          p_body: string
          p_did: string
          p_from: string
          p_media: Json
          p_org_id: string
          p_provider_msg_id: number
          p_provider_session_id: number
          p_received_at: string
        }
        Returns: Json
      }
      record_interac_notice_for_service: {
        Args: {
          p_amount_cents: number
          p_message: string
          p_org_id: string
          p_received_on: string
          p_reference: string
          p_sender_name: string
          p_source_ref: string
        }
        Returns: string
      }
      record_mail_attachment: {
        Args: {
          p_attachment_id: string
          p_org_id: string
          p_status: string
          p_stored_file_id: string
        }
        Returns: undefined
      }
      record_monthly_sessions: {
        Args: { p_entries: Json; p_month: string }
        Returns: number
      }
      record_payment: {
        Args: {
          p_amount_cents: number
          p_invoice_id: string
          p_mode_code: string
          p_note?: string
          p_paid_on?: string
          p_reference?: string
        }
        Returns: string
      }
      record_professional_invitation_email_failure_for_service: {
        Args: { p_code: string; p_link_id: string; p_org: string }
        Returns: undefined
      }
      record_professional_paper_contract: {
        Args: { p_file_id: string; p_id: string; p_signed_on: string }
        Returns: string
      }
      record_qbo_item_for_service: {
        Args: {
          p_income_account_id: string
          p_name: string
          p_org_id: string
          p_qbo_id: string
          p_sku: string
        }
        Returns: undefined
      }
      record_qbo_link_for_service: {
        Args: {
          p_client: string
          p_kind: string
          p_org_id: string
          p_payer: string
          p_qbo_customer_id: string
        }
        Returns: undefined
      }
      record_qbo_organisation_link_for_service: {
        Args: {
          p_client: string
          p_kind: string
          p_org_id: string
          p_organisation: string
          p_qbo_customer_id: string
          p_source: string
        }
        Returns: undefined
      }
      record_qbo_push_for_service: {
        Args: {
          p_amount_mismatch?: boolean
          p_entity: string
          p_error_code: string
          p_event_id: number
          p_invoice: string
          p_kind: string
          p_org_id: string
          p_qbo_customer_id: string
          p_qbo_id: string
        }
        Returns: string
      }
      record_qbo_vendor_for_service: {
        Args: {
          p_org_id: string
          p_professional: string
          p_qbo_vendor_id: string
        }
        Returns: undefined
      }
      record_signature_sync: {
        Args: {
          p_error_code?: string
          p_id: string
          p_org_id: string
          p_read?: boolean
          p_report_codes?: string[]
        }
        Returns: string[]
      }
      record_stripe_card_for_service: {
        Args: {
          p_brand: string
          p_customer_id: string
          p_exp_month: number
          p_exp_year: number
          p_last4: string
          p_org_id: string
          p_payment_method_id: string
        }
        Returns: Json
      }
      record_stripe_payment_for_service: {
        Args: {
          p_amount_cents: number
          p_charge_id?: string
          p_invoice_id: string
          p_org_id: string
          p_paid_at: string
          p_payment_intent_id: string
        }
        Returns: Json
      }
      recover_signature_request: {
        Args: {
          p_envelope_id: string
          p_id: string
          p_org_id: string
          p_signer_recipients: Json
        }
        Returns: string
      }
      refund_payment: {
        Args: { p_amount_cents: number; p_payment_id: string; p_reason: string }
        Returns: string
      }
      refund_rate_limit: {
        Args: { p_bucket: string; p_key_hash: string; p_window_seconds: number }
        Returns: undefined
      }
      refunds_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          amount_cents: number
          created_at: string
          id: string
          invoice_id: string
          payment_external_ref: string
          payment_id: string
        }[]
      }
      register_system_file: {
        Args: {
          p_bucket: string
          p_mime_type: string
          p_module_key: string
          p_org_id: string
          p_original_name: string
          p_purpose: string
          p_sha256: string
          p_size_bytes: number
          p_subject_id: string
          p_subject_type: string
          p_view_permission: string
        }
        Returns: {
          file_id: string
          object_path: string
        }[]
      }
      register_waitlist: {
        Args: {
          p_demande_id: string
          p_priority?: string
          p_priority_reason?: string
          p_targets: Json
        }
        Returns: string[]
      }
      reissue_professional_invitation_for_service: {
        Args: { p_id: string; p_org: string; p_token_hash: string }
        Returns: Json
      }
      reject_professional_document: {
        Args: { p_doc_id: string; p_reason: string }
        Returns: undefined
      }
      reject_professional_submission: {
        Args: { p_note: string; p_submission_id: string }
        Returns: undefined
      }
      reject_stored_file: { Args: { p_file_id: string }; Returns: undefined }
      release_invoice_draft: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      release_sms_claims_for_service: {
        Args: { p_ids: string[]; p_org_id: string }
        Returns: number
      }
      release_sms_provider_lock: {
        Args: { p_org_id: string; p_owner: string }
        Returns: undefined
      }
      remove_availability_exception: {
        Args: { p_id: string }
        Returns: undefined
      }
      remove_client_relation: {
        Args: { p_client_id: string; p_related_id: string }
        Returns: undefined
      }
      remove_invoice_line: { Args: { p_line_id: string }; Returns: undefined }
      remove_module_tester: {
        Args: { p_key: string; p_user_id: string }
        Returns: undefined
      }
      remove_payout_adjustment: {
        Args: { p_line_id: string }
        Returns: undefined
      }
      rename_role: {
        Args: { p_name: string; p_role: string }
        Returns: undefined
      }
      renew_staff_invitation: {
        Args: { p_actor: string; p_id: string; p_token_hash: string }
        Returns: {
          display_name: string
          email: string
          expires_at: string
        }[]
      }
      reopen_payout_period: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reorder_professionals_reference: {
        Args: { p_ids: string[]; p_kind: string }
        Returns: undefined
      }
      replace_calendar_busy_for_service: {
        Args: {
          p_blocks: Json
          p_connected_at: string
          p_connection_id: string
          p_from: string
          p_org_id: string
          p_to: string
        }
        Returns: number
      }
      replace_qbo_accounts: {
        Args: { p_accounts: Json; p_org_id: string }
        Returns: number
      }
      replace_qbo_items: {
        Args: { p_items: Json; p_org_id: string }
        Returns: number
      }
      replace_qbo_tax_codes: {
        Args: { p_codes: Json; p_org_id: string }
        Returns: number
      }
      report_cancellations: {
        Args: {
          p_from: string
          p_kind?: string
          p_professional_id?: string
          p_reason_id?: string
          p_to: string
        }
        Returns: Json
      }
      report_clients_to_follow_up: {
        Args: { p_from: string; p_professional_id?: string; p_to: string }
        Returns: Json
      }
      report_consents: {
        Args: { p_from: string; p_professional_id?: string; p_to: string }
        Returns: Json
      }
      report_demandes: { Args: { p_from: string; p_to: string }; Returns: Json }
      report_ivac: {
        Args: {
          p_from: string
          p_professional_id?: string
          p_state?: string
          p_to: string
        }
        Returns: Json
      }
      report_payouts: {
        Args: { p_from: string; p_professional_id?: string; p_to: string }
        Returns: Json
      }
      report_revenue: {
        Args: {
          p_from: string
          p_mode_code?: string
          p_professional_id?: string
          p_service_id?: string
          p_to: string
          p_view: string
        }
        Returns: Json
      }
      request_mail_sync: {
        Args: { p_email_address: string; p_org_id: string }
        Returns: string
      }
      request_payout_correction: {
        Args: { p_id: string; p_note: string }
        Returns: undefined
      }
      request_professional_update: {
        Args: { p_id: string; p_sections: string[] }
        Returns: Json
      }
      reschedule_demande_task: {
        Args: { p_demande_id: string; p_due_at: string; p_task_id: string }
        Returns: undefined
      }
      reset_email_template: { Args: { p_key: string }; Returns: undefined }
      reset_mail_history: {
        Args: { p_connection_id: string; p_org_id: string; p_token?: string }
        Returns: boolean
      }
      resolve_appointment_confirm_link: {
        Args: { p_link_id: string }
        Returns: Json
      }
      resolve_billing_card_link: { Args: { p_link_id: string }; Returns: Json }
      resolve_billing_pay_link: { Args: { p_link_id: string }; Returns: Json }
      resolve_client_consent_link: {
        Args: { p_link_id: string }
        Returns: Json
      }
      resolve_discovery_call_link: {
        Args: { p_link_id: string }
        Returns: Json
      }
      resolve_professional_invitation: {
        Args: { p_link_id: string }
        Returns: Json
      }
      resolve_proposition_link: { Args: { p_link_id: string }; Returns: Json }
      resolve_staff_invitation: { Args: { p_link_id: string }; Returns: Json }
      resolve_waitlist_followup_link: {
        Args: { p_link_id: string }
        Returns: Json
      }
      restore_appointment: { Args: { p_id: string }; Returns: undefined }
      restore_professional_invitation_for_service: {
        Args: {
          p_id: string
          p_link_id: string
          p_org: string
          p_previous_link_id: string
        }
        Returns: boolean
      }
      retry_appointment_video: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      retry_qbo_push: { Args: { p_id: string }; Returns: undefined }
      reveal_bank_account_number: { Args: never; Returns: string }
      reveal_professional_private: {
        Args: { p_field: string; p_id: string }
        Returns: string
      }
      revoke_professional_invitation: {
        Args: { p_id: string }
        Returns: undefined
      }
      revoke_staff_invitation: { Args: { p_id: string }; Returns: undefined }
      run_professionals_document_notices_for_service: {
        Args: { p_org: string; p_today?: string }
        Returns: Json
      }
      run_scheduled_job_now: { Args: { p_key: string }; Returns: undefined }
      save_client_payer: {
        Args: {
          p_client_id: string
          p_coverage_percent?: number
          p_expires_on: string
          p_file_number: string
          p_id: string
          p_kind: string
          p_max_amount_cents: number
          p_max_sessions: number
          p_note: string
          p_organisation_name: string
          p_prior_used_cents?: number
          p_prior_used_on?: string
          p_prior_used_sessions?: number
          p_renewal_day?: number
          p_renewal_month?: number
          p_session_amount_cents: number
          p_starts_on: string
        }
        Returns: string
      }
      save_client_tag: {
        Args: { p_id: string; p_name: string }
        Returns: string
      }
      save_clientele: {
        Args: {
          p_id: string
          p_max_age: number
          p_min_age: number
          p_name: string
        }
        Returns: string
      }
      save_consent_draft: {
        Args: { p_body: string; p_key: string; p_title: string }
        Returns: string
      }
      save_deactivation_reason: {
        Args: {
          p_disables_account: boolean
          p_id: string
          p_name: string
          p_requires_note: boolean
        }
        Returns: string
      }
      save_document_type: {
        Args: {
          p_accepted_mime?: string[]
          p_expiry_rule?: string
          p_id: string
          p_max_bytes?: number
          p_name: string
          p_reminder_days?: number[]
          p_required?: boolean
          p_weekly_after_expiry?: boolean
        }
        Returns: string
      }
      save_email_template: {
        Args: {
          p_body: string
          p_button_label: string
          p_key: string
          p_subject: string
        }
        Returns: undefined
      }
      save_language: {
        Args: { p_code: string; p_id: string; p_name: string }
        Returns: string
      }
      save_mail_draft: { Args: { p_draft: Json; p_id: string }; Returns: Json }
      save_mail_template: {
        Args: {
          p_body_html: string
          p_id: string
          p_name: string
          p_subject: string
        }
        Returns: string
      }
      save_motif: {
        Args: {
          p_category_id: string
          p_id: string
          p_is_restricted: boolean
          p_name: string
        }
        Returns: string
      }
      save_motif_category: {
        Args: {
          p_description: string
          p_icon: string
          p_id: string
          p_name: string
        }
        Returns: string
      }
      save_my_submission_draft: {
        Args: { p_section: string; p_values: Json }
        Returns: string
      }
      save_my_submission_private: {
        Args: {
          p_bank_account: string
          p_bank_institution: string
          p_bank_transit: string
          p_business_number: string
          p_gst_number: string
          p_qst_number: string
          p_sin: string
        }
        Returns: undefined
      }
      save_payer_organisation: {
        Args: {
          p_billing_email: string
          p_cadence: string
          p_contact_name: string
          p_due_days: number
          p_id: string
          p_is_active: boolean
          p_kind: string
          p_language: string
          p_name: string
          p_note: string
          p_provider_number: string
          p_reminders_enabled: boolean
        }
        Returns: string
      }
      save_profession_category: {
        Args: { p_id: string; p_name: string }
        Returns: string
      }
      save_profession_title: {
        Args: {
          p_category_id: string
          p_id: string
          p_name: string
          p_name_feminine: string
          p_name_masculine: string
          p_order_id: string
        }
        Returns: string
      }
      save_professional_order: {
        Args: {
          p_acronym: string
          p_id: string
          p_licence_label: string
          p_licence_pattern: string
          p_name: string
        }
        Returns: string
      }
      save_service: {
        Args: {
          p_buffer_after_minutes: number
          p_code: number
          p_colour: string
          p_description: string
          p_duration_minutes: number
          p_family_id: string
          p_fixed_price_cents: number
          p_for_two: boolean
          p_grid_duration: number
          p_id: string
          p_key: string
          p_kind: string
          p_name: string
          p_price_source: string
          p_sort_order: number
          p_tax_rule: string
        }
        Returns: string
      }
      save_stripe_customer_for_service: {
        Args: {
          p_customer_id: string
          p_org_id: string
          p_payer_client_id: string
        }
        Returns: undefined
      }
      search_clients: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          birthday: string
          client_number: number
          email: string
          first_name: string
          id: string
          is_archived: boolean
          last_name: string
          mobile_e164: string
        }[]
      }
      search_professionals: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          display_status: string
          first_name: string
          id: string
          last_name: string
          licence_number: string
          order_acronym: string
          status: string
          title_label: string
        }[]
      }
      send_billing_document: {
        Args: { p_id: string; p_kind: string }
        Returns: string
      }
      send_invoices: {
        Args: { p_invoice_ids: string[] }
        Returns: {
          error: string
          invoice_id: string
          number: string
        }[]
      }
      send_payout_periods: { Args: { p_ids: string[] }; Returns: Json }
      set_ai_settings: {
        Args: {
          p_enabled: boolean
          p_input_cents_per_mtok: number
          p_model: string
          p_monthly_cap_cents: number
          p_output_cents_per_mtok: number
        }
        Returns: undefined
      }
      set_appointment_details: {
        Args: {
          p_client_message: string
          p_id: string
          p_internal_note: string
          p_mode: string
        }
        Returns: undefined
      }
      set_appointment_presence: {
        Args: {
          p_appointment_id: string
          p_client_id: string
          p_presence: string
        }
        Returns: undefined
      }
      set_appointment_settings: {
        Args: {
          p_business_days: number[]
          p_business_end: string
          p_business_start: string
          p_late_notice_business_hours?: boolean
          p_reminder_business_days: number
          p_reminder_local_hour: number
        }
        Returns: undefined
      }
      set_availability_rule: {
        Args: {
          p_end_time: string
          p_id: string
          p_overflow_allowed: boolean
          p_professional_id: string
          p_service_ids: string[]
          p_start_time: string
          p_valid_from: string
          p_valid_until: string
          p_visible_to_clients: boolean
          p_weekday: number
        }
        Returns: string
      }
      set_availability_window: {
        Args: {
          p_end_time: string
          p_id: string
          p_professional_id: string
          p_start_time: string
          p_valid_from: string
          p_valid_until: string
          p_week?: string
          p_weekday: number
        }
        Returns: Json
      }
      set_bank_details: {
        Args: {
          p_account_number: string
          p_etransfer_email: string
          p_institution_number: string
          p_transit_number: string
        }
        Returns: undefined
      }
      set_billing_dunning: {
        Args: {
          p_block_after_days: number
          p_days: number[]
          p_dunning_from: string
        }
        Returns: undefined
      }
      set_billing_invoice_note: {
        Args: { p_en: string; p_fr: string }
        Returns: undefined
      }
      set_billing_queue_from: {
        Args: { p_queue_from: string }
        Returns: undefined
      }
      set_calendar_token_for_service: {
        Args: {
          p_access_token: string
          p_access_token_expires_at: string
          p_connected_at: string
          p_connection_id: string
          p_org_id: string
        }
        Returns: boolean
      }
      set_client_consent_clauses: {
        Args: { p_clauses: Json; p_version_id: string }
        Returns: Json
      }
      set_client_consent_rule: {
        Args: {
          p_consent_key: string
          p_frequency: string
          p_id: string
          p_is_active: boolean
          p_target: string
          p_trigger_kind: string
        }
        Returns: string
      }
      set_client_consent_settings: { Args: { p_patch: Json }; Returns: Json }
      set_client_notes: {
        Args: {
          p_admin_notes: string
          p_id: string
          p_special_agreement_note: string
        }
        Returns: undefined
      }
      set_client_payer_organisation: {
        Args: { p_client_payer_id: string; p_organisation_id: string }
        Returns: undefined
      }
      set_client_relation: {
        Args: {
          p_client_id: string
          p_client_rights?: Json
          p_related_id: string
          p_related_rights?: Json
          p_type: string
        }
        Returns: undefined
      }
      set_client_tag_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_client_tags: {
        Args: { p_client_id: string; p_tag_ids: string[] }
        Returns: undefined
      }
      set_communications_settings: { Args: { p_patch: Json }; Returns: Json }
      set_compensation_rate: {
        Args: {
          p_effective_from: string
          p_kind: string
          p_retention_pct: number
        }
        Returns: string
      }
      set_default_payer: {
        Args: { p_client_id: string; p_payer_client_id: string }
        Returns: undefined
      }
      set_demande_handler: {
        Args: { p_expected?: string; p_id: string; p_take: boolean }
        Returns: undefined
      }
      set_demande_note: {
        Args: { p_id: string; p_note: string }
        Returns: undefined
      }
      set_demande_participants: {
        Args: { p_id: string; p_participants: Json }
        Returns: undefined
      }
      set_demande_source: {
        Args: { p_channel: string; p_id: string; p_referral_source_id: string }
        Returns: undefined
      }
      set_demande_state: {
        Args: {
          p_closed_reason?: string
          p_id: string
          p_professional_id?: string
          p_state: string
        }
        Returns: undefined
      }
      set_demandes_booking_settings: {
        Args: { p_settings: Json }
        Returns: Json
      }
      set_demandes_waitlist_settings: {
        Args: { p_settings: Json }
        Returns: Json
      }
      set_document_template_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_email_sender: {
        Args: {
          p_from_address: string
          p_from_name: string
          p_reply_to: string
        }
        Returns: undefined
      }
      set_email_sending_domain: {
        Args: { p_domain: string }
        Returns: undefined
      }
      set_invoice_line_price: {
        Args: { p_line_id: string; p_unit_price_cents: number }
        Returns: undefined
      }
      set_invoice_notes: {
        Args: {
          p_invoice_id: string
          p_notes_client: string
          p_notes_internal: string
        }
        Returns: undefined
      }
      set_invoice_payer: {
        Args: { p_invoice_id: string; p_payer_client_id: string }
        Returns: undefined
      }
      set_invoice_sequence: {
        Args: { p_last_number: number; p_year: number }
        Returns: undefined
      }
      set_ivac_rate: {
        Args: { p_effective_from: string; p_session_cents: number }
        Returns: undefined
      }
      set_mail_access_token: {
        Args: {
          p_access_token: string
          p_connection_id: string
          p_expires_at: string
          p_org_id: string
        }
        Returns: undefined
      }
      set_mail_connection_status: {
        Args: {
          p_connection_id: string
          p_org_id: string
          p_reason: string
          p_status: string
        }
        Returns: undefined
      }
      set_mail_watch: {
        Args: {
          p_connection_id: string
          p_expires_at: string
          p_history_id: number
          p_org_id: string
        }
        Returns: undefined
      }
      set_module_enabled: {
        Args: { p_enabled: boolean; p_key: string }
        Returns: undefined
      }
      set_module_testers_only: {
        Args: { p_key: string; p_testers_only: boolean }
        Returns: undefined
      }
      set_org_asset: {
        Args: { p_file_id: string; p_kind: string }
        Returns: undefined
      }
      set_org_secret: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      set_payout_rule: {
        Args: { p_rule: string; p_service_id: string }
        Returns: undefined
      }
      set_permission_override: {
        Args: {
          p_granted: boolean
          p_permission_key: string
          p_user_id: string
        }
        Returns: undefined
      }
      set_professional_bank: {
        Args: {
          p_account: string
          p_expected_updated_at: string
          p_id: string
          p_institution: string
          p_transit: string
        }
        Returns: string
      }
      set_professional_client_agreement: {
        Args: {
          p_client_label: string
          p_client_price_cents: number
          p_duration: number
          p_effective_from: string
          p_id: string
          p_note: string
          p_professional_amount_cents: number
        }
        Returns: string
      }
      set_professional_clienteles: {
        Args: { p_id: string; p_items: Json }
        Returns: {
          clientele_id: string
          is_specialized: boolean
        }[]
      }
      set_professional_document_expiry: {
        Args: { p_doc_id: string; p_expires_on: string }
        Returns: undefined
      }
      set_professional_email: {
        Args: { p_email: string; p_id: string }
        Returns: undefined
      }
      set_professional_languages: {
        Args: { p_id: string; p_language_ids: string[] }
        Returns: string[]
      }
      set_professional_matching_note: {
        Args: { p_id: string; p_note: string }
        Returns: Json
      }
      set_professional_matching_priority: {
        Args: { p_id: string; p_reason: string }
        Returns: Json
      }
      set_professional_motifs: {
        Args: { p_id: string; p_motif_ids: string[] }
        Returns: string[]
      }
      set_professional_new_client_places: {
        Args: { p_id: string; p_places: number; p_restart?: boolean }
        Returns: Json
      }
      set_professional_payer_number: {
        Args: { p_id: string; p_number: string; p_payer_type: string }
        Returns: undefined
      }
      set_professional_professions: {
        Args: { p_id: string; p_items: Json }
        Returns: {
          id: string
          is_primary: boolean
          licence_number: string
          profession_title_id: string
        }[]
      }
      set_professional_refused_motifs: {
        Args: { p_id: string; p_motif_ids: string[] }
        Returns: string[]
      }
      set_professional_sin: {
        Args: { p_expected_updated_at: string; p_id: string; p_sin: string }
        Returns: string
      }
      set_professional_supervisor: {
        Args: { p_professional_id: string; p_supervisor_id: string }
        Returns: undefined
      }
      set_professional_tax_numbers: {
        Args: {
          p_business_number: string
          p_expected_updated_at: string
          p_gst_number: string
          p_id: string
          p_qst_number: string
        }
        Returns: string
      }
      set_professional_video_link: {
        Args: { p_professional_id: string; p_url: string }
        Returns: undefined
      }
      set_professionals_reference_active: {
        Args: { p_active: boolean; p_id: string; p_kind: string }
        Returns: undefined
      }
      set_professionals_settings: { Args: { p_patch: Json }; Returns: Json }
      set_qbo_account_map: {
        Args: {
          p_account_id: string
          p_key: string
          p_profession_title_id: string
        }
        Returns: undefined
      }
      set_qbo_connection_status: {
        Args: { p_org_id: string; p_reason: string; p_status: string }
        Returns: undefined
      }
      set_qbo_push_paused: { Args: { p_paused: boolean }; Returns: undefined }
      set_qbo_tokens: {
        Args: {
          p_access_token: string
          p_access_token_expires_at: string
          p_connection_id: string
          p_org_id: string
          p_previous_refresh: string
          p_refresh_token: string
          p_refresh_token_expires_at: string
        }
        Returns: boolean
      }
      set_retention_grid: {
        Args: {
          p_effective_from: string
          p_note: string
          p_prices: Json
          p_tiers: Json
          p_title_id: string
        }
        Returns: string
      }
      set_role_permission: {
        Args: { p_granted: boolean; p_permission_key: string; p_role: string }
        Returns: undefined
      }
      set_scheduled_job_enabled: {
        Args: { p_enabled: boolean; p_key: string }
        Returns: undefined
      }
      set_service_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_service_titles: {
        Args: { p_id: string; p_title_ids: string[] }
        Returns: undefined
      }
      set_signing_settings: { Args: { p: Json }; Returns: Json }
      set_sms_consent: {
        Args: {
          p_note?: string
          p_phone: string
          p_status: string
          p_subject_id?: string
          p_subject_type?: string
        }
        Returns: Json
      }
      set_sms_provider_channel: {
        Args: { p_channel_name: string; p_org_id: string }
        Returns: undefined
      }
      set_sms_settings: { Args: { p_patch: Json }; Returns: Json }
      set_special_agreement: {
        Args: { p_client_id: string; p_note: string }
        Returns: undefined
      }
      set_user_preference: {
        Args: { p_key: string; p_user_id: string; p_value: Json }
        Returns: undefined
      }
      set_user_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
      set_user_status: {
        Args: { p_status: string; p_user_id: string }
        Returns: undefined
      }
      set_waitlist_fee: {
        Args: { p_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      set_zoom_tokens_for_service: {
        Args: {
          p_access_token: string
          p_access_token_expires_at: string
          p_connected_at: string
          p_connection_id: string
          p_org_id: string
          p_refresh_token: string
        }
        Returns: boolean
      }
      settle_stripe_refund_for_service: {
        Args: {
          p_error_code: string
          p_ok: boolean
          p_org_id: string
          p_provider_ref: string
          p_refund_id: string
        }
        Returns: boolean
      }
      sms_event_known_for_service: {
        Args: {
          p_org_id: string
          p_provider_msg_id: number
          p_provider_session_id: number
        }
        Returns: string
      }
      start_client_consent_campaign: {
        Args: { p_consent_key: string }
        Returns: Json
      }
      start_client_consent_signing_for_service: {
        Args: {
          p_answers: Json
          p_birth_year: number
          p_first_name: string
          p_idempotency_key: string
          p_token_hash: string
        }
        Returns: Json
      }
      start_job_run: {
        Args: { p_key: string; p_org_id: string; p_trigger: string }
        Returns: string
      }
      start_my_profile_update: {
        Args: { p_sections: string[] }
        Returns: string
      }
      store_calendar_connection: {
        Args: {
          p_access_token: string
          p_access_token_expires_at: string
          p_account_email: string
          p_actor: string
          p_external_user_id: string
          p_org_id: string
          p_refresh_token: string
          p_scopes: string[]
        }
        Returns: string
      }
      store_mail_connection: {
        Args: {
          p_access_token: string
          p_access_token_expires_at: string
          p_actor: string
          p_email_address: string
          p_kind: string
          p_org_id: string
          p_refresh_token: string
          p_scopes: string[]
        }
        Returns: string
      }
      store_qbo_connection: {
        Args: {
          p_access_token: string
          p_access_token_expires_at: string
          p_actor: string
          p_company_name: string
          p_environment: string
          p_org_id: string
          p_realm_id: string
          p_refresh_token: string
          p_refresh_token_expires_at: string
        }
        Returns: string
      }
      store_sms_provider_session: {
        Args: {
          p_access_expires_at: string
          p_access_token: string
          p_base_url: string
          p_org_id: string
          p_refresh_expires_at: string
          p_refresh_token: string
        }
        Returns: undefined
      }
      store_zoom_connection: {
        Args: {
          p_access_token: string
          p_access_token_expires_at: string
          p_account_email: string
          p_actor: string
          p_external_account_id: string
          p_external_user_id: string
          p_org_id: string
          p_refresh_token: string
          p_scopes: string[]
        }
        Returns: string
      }
      stripe_card_for_service: {
        Args: { p_actor: string; p_org_id: string; p_payer_client_id: string }
        Returns: Json
      }
      stripe_card_link_context_for_service: {
        Args: { p_actor: string; p_org_id: string; p_payer_client_id: string }
        Returns: Json
      }
      stripe_card_removed_for_service: {
        Args: { p_actor: string; p_org_id: string; p_payer_client_id: string }
        Returns: undefined
      }
      stripe_charges_due_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          invoice_id: string
        }[]
      }
      stripe_payment_failed_for_service: {
        Args: {
          p_charge_id?: string
          p_failure_code: string
          p_org_id: string
          p_payment_intent_id: string
        }
        Returns: undefined
      }
      stripe_refund_for_service: {
        Args: { p_org_id: string; p_refund_id: string }
        Returns: Json
      }
      stripe_refunds_due_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          amount_cents: number
          invoice_id: string
          payment_intent_id: string
          refund_id: string
        }[]
      }
      submit_my_submission: { Args: never; Returns: undefined }
      tax_rate_on: { Args: { p_date: string; p_tax: string }; Returns: number }
      unarchive_client: { Args: { p_id: string }; Returns: undefined }
      unlink_mail_thread: { Args: { p_thread_id: string }; Returns: undefined }
      unlink_sms_thread: { Args: { p_phone: string }; Returns: undefined }
      update_client: {
        Args: { p_client: Json; p_id: string }
        Returns: undefined
      }
      update_demande: {
        Args: { p_id: string; p_patch: Json }
        Returns: undefined
      }
      update_template_version: {
        Args: {
          p_body: Json
          p_email_message: string
          p_email_subject: string
          p_id: string
          p_signers: Json
          p_variables: Json
        }
        Returns: undefined
      }
      update_waitlist_entry: {
        Args: { p_id: string; p_patch: Json }
        Returns: undefined
      }
      upsert_client_insurance: {
        Args: {
          p_certificate_number: string
          p_client_id: string
          p_holder_name: string
          p_holder_relation: string
          p_insurer: string
          p_policy_number: string
          p_rank: number
        }
        Returns: undefined
      }
      upsert_mail_labels: {
        Args: { p_connection_id: string; p_labels: Json; p_org_id: string }
        Returns: number
      }
      upsert_mail_messages: {
        Args: { p_connection_id: string; p_messages: Json; p_org_id: string }
        Returns: {
          gmail_message_id: string
          inserted: boolean
          message_id: string
        }[]
      }
      upsert_qbo_customers: {
        Args: { p_customers: Json; p_org_id: string; p_sync_started_at: string }
        Returns: number
      }
      validate_payout_period: { Args: { p_id: string }; Returns: undefined }
      verify_professional_document: {
        Args: { p_doc_id: string; p_expires_on?: string }
        Returns: undefined
      }
      video_link_email_for_service: {
        Args: { p_appointment_id: string; p_org_id: string }
        Returns: {
          clinic_name: string
          email: string
          first_name: string
          join_url: string
          language: string
          professional_name: string
          starts_at: string
        }[]
      }
      waitlist_followup_for_service: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: Json
      }
      waitlist_lists: {
        Args: never
        Returns: {
          average_wait_days: number
          incomplete_count: number
          name: string
          offered_count: number
          open_count: number
          target_id: string
          target_kind: string
          to_call_count: number
        }[]
      }
      withdraw_client_consent: {
        Args: { p_id: string; p_note: string }
        Returns: string
      }
      withdraw_professional_image_consent: {
        Args: { p_id: string; p_note?: string; p_withdrawn_on: string }
        Returns: number
      }
      withdraw_proposition: { Args: { p_id: string }; Returns: undefined }
      zoom_deauthorized_for_service: {
        Args: { p_external_user_id: string; p_org_id: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const

