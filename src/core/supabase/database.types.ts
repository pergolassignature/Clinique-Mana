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
      org_modules: {
        Row: {
          disabled_at: string | null
          enabled: boolean
          module_key: string
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          disabled_at?: string | null
          enabled?: boolean
          module_key: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          disabled_at?: string | null
          enabled?: boolean
          module_key?: string
          org_id?: string
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
      signature_request_signers: {
        Row: {
          created_at: string
          documenso_recipient_id: string | null
          email: string
          id: string
          name: string
          org_id: string
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
          documenso_document_id: string | null
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
          superseded_document_ids: string[]
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
          documenso_document_id?: string | null
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
          superseded_document_ids?: string[]
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
          documenso_document_id?: string | null
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
          superseded_document_ids?: string[]
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
    }
    Functions: {
      accept_staff_invitation: {
        Args: { p_payload: Json; p_token_hash: string; p_user_id: string }
        Returns: Json
      }
      activate_professional: {
        Args: { p_id: string; p_override_reason?: string }
        Returns: {
          account_change: string
          profile_id: string
          status: string
        }[]
      }
      add_tax_rate: {
        Args: { p_effective_from: string; p_rate: number; p_tax: string }
        Returns: string
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
      archive_template_version: { Args: { p_id: string }; Returns: undefined }
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
      begin_signature_request_send: {
        Args: { p_id: string; p_org_id: string; p_stale_after: string }
        Returns: boolean
      }
      cancel_professional_submission: {
        Args: { p_submission_id: string }
        Returns: undefined
      }
      cancel_signature_request: {
        Args: { p_by: string; p_id: string }
        Returns: boolean
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
      complete_signature_request: {
        Args: {
          p_id: string
          p_signed_file_id: string
          p_signed_sha256: string
        }
        Returns: undefined
      }
      complete_webhook_event: {
        Args: { p_claim_token: string; p_id: string }
        Returns: boolean
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
      create_role: {
        Args: { p_copy_from?: string; p_name: string }
        Returns: string
      }
      create_signature_request: {
        Args: { p: Json }
        Returns: {
          created_at: string
          documenso_document_id: string
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
      delete_compensation_rate: { Args: { p_id: string }; Returns: undefined }
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
      delete_tax_rate: { Args: { p_id: string }; Returns: undefined }
      delete_user_preference: {
        Args: { p_key: string; p_user_id: string }
        Returns: undefined
      }
      discard_consent_draft: { Args: { p_id: string }; Returns: undefined }
      discard_system_file: {
        Args: { p_file_id: string; p_org_id: string }
        Returns: boolean
      }
      end_professional_client_agreement: {
        Args: { p_effective_to: string; p_row_id: string }
        Returns: undefined
      }
      expire_signature_request: { Args: { p_id: string }; Returns: boolean }
      fail_webhook_event: {
        Args: { p_claim_token: string; p_error: string; p_id: string }
        Returns: boolean
      }
      finish_job_run: {
        Args: { p_detail: string; p_id: string; p_status: string }
        Returns: undefined
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
      get_consent_versions: { Args: { p_key?: string }; Returns: Json }
      get_email_context: {
        Args: { p_org_id: string; p_template_key: string }
        Returns: Json
      }
      get_my_access: { Args: never; Returns: Json }
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
      get_org_secret: {
        Args: { p_key: string; p_org_id: string }
        Returns: string
      }
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
      get_signature_request: {
        Args: { p_id: string }
        Returns: {
          completed_at: string
          documenso_document_id: string
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
      get_submission_review: {
        Args: { p_submission_id: string }
        Returns: Json
      }
      import_professional: {
        Args: { p_dry_run?: boolean; p_row: Json }
        Returns: Json
      }
      last_webhook_event_at: { Args: { p_provider: string }; Returns: string }
      link_professional_account: {
        Args: { p_payload: Json; p_token_hash: string; p_user_id: string }
        Returns: Json
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
      list_files_to_purge: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          bucket: string
          id: string
          object_path: string
        }[]
      }
      list_job_orgs: { Args: { p_key: string }; Returns: string[] }
      list_modules: {
        Args: never
        Returns: {
          depends_on: string[]
          enabled: boolean
          key: string
          name: string
        }[]
      }
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
      list_signature_requests_to_reconcile: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          action: string
          documenso_document_id: string
          envelope_id: string
          expires_at: string
          id: string
          module_key: string
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
      mark_all_notifications_read: { Args: never; Returns: undefined }
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
      module_enabled: { Args: { p_key: string }; Returns: boolean }
      module_enabled_for_org: {
        Args: { p_key: string; p_org_id: string }
        Returns: boolean
      }
      peek_secure_link: {
        Args: { p_mark_opened: boolean; p_token_hash: string }
        Returns: Json
      }
      pii_health_check: { Args: never; Returns: boolean }
      prepare_my_image_consent: {
        Args: { p_action: string; p_actor: string; p_idempotency_key: string }
        Returns: Json
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
      publish_consent_version: { Args: { p_id: string }; Returns: undefined }
      publish_template_version: { Args: { p_id: string }; Returns: undefined }
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
      record_monthly_sessions: {
        Args: { p_entries: Json; p_month: string }
        Returns: number
      }
      record_professional_invitation_email_failure_for_service: {
        Args: { p_code: string; p_link_id: string; p_org: string }
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
      recover_signature_request: {
        Args: {
          p_envelope_id: string
          p_id: string
          p_org_id: string
          p_signer_recipients: Json
        }
        Returns: string
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
      reorder_professionals_reference: {
        Args: { p_ids: string[]; p_kind: string }
        Returns: undefined
      }
      request_professional_update: {
        Args: { p_id: string; p_sections: string[] }
        Returns: Json
      }
      reset_email_template: { Args: { p_key: string }; Returns: undefined }
      resolve_professional_invitation: {
        Args: { p_link_id: string }
        Returns: Json
      }
      resolve_staff_invitation: { Args: { p_link_id: string }; Returns: Json }
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
      set_bank_details: {
        Args: {
          p_account_number: string
          p_etransfer_email: string
          p_institution_number: string
          p_transit_number: string
        }
        Returns: undefined
      }
      set_compensation_rate: {
        Args: {
          p_effective_from: string
          p_kind: string
          p_retention_pct: number
        }
        Returns: string
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
      set_module_enabled: {
        Args: { p_enabled: boolean; p_key: string }
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
      set_professional_motifs: {
        Args: { p_id: string; p_motif_ids: string[] }
        Returns: string[]
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
      set_professional_sin: {
        Args: { p_expected_updated_at: string; p_id: string; p_sin: string }
        Returns: string
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
      set_professionals_reference_active: {
        Args: { p_active: boolean; p_id: string; p_kind: string }
        Returns: undefined
      }
      set_professionals_settings: { Args: { p_patch: Json }; Returns: Json }
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
      set_signing_settings: { Args: { p: Json }; Returns: Json }
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
      start_job_run: {
        Args: { p_key: string; p_org_id: string; p_trigger: string }
        Returns: string
      }
      start_my_profile_update: {
        Args: { p_sections: string[] }
        Returns: string
      }
      submit_my_submission: { Args: never; Returns: undefined }
      tax_rate_on: { Args: { p_date: string; p_tax: string }; Returns: number }
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
      verify_professional_document: {
        Args: { p_doc_id: string; p_expires_on?: string }
        Returns: undefined
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

