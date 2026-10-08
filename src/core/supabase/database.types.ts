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
          enabled: boolean
          module_key: string
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          module_key: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
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
          signatory_name: string | null
          signatory_title: string | null
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
          signatory_name?: string | null
          signatory_title?: string | null
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
          signatory_name?: string | null
          signatory_title?: string | null
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      add_tax_rate: {
        Args: { p_effective_from: string; p_rate: number; p_tax: string }
        Returns: string
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
      complete_webhook_event: {
        Args: { p_claim_token: string; p_id: string }
        Returns: boolean
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
      create_role: {
        Args: { p_copy_from?: string; p_name: string }
        Returns: string
      }
      delete_org_secret: { Args: { p_key: string }; Returns: undefined }
      delete_role: { Args: { p_role: string }; Returns: undefined }
      delete_tax_rate: { Args: { p_id: string }; Returns: undefined }
      fail_webhook_event: {
        Args: { p_claim_token: string; p_error: string; p_id: string }
        Returns: boolean
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
      get_my_access: { Args: never; Returns: Json }
      get_org_secret: {
        Args: { p_key: string; p_org_id: string }
        Returns: string
      }
      last_webhook_event_at: { Args: { p_provider: string }; Returns: string }
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
      list_modules: {
        Args: never
        Returns: {
          depends_on: string[]
          enabled: boolean
          key: string
          name: string
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
      module_enabled: { Args: { p_key: string }; Returns: boolean }
      module_enabled_for_org: {
        Args: { p_key: string; p_org_id: string }
        Returns: boolean
      }
      rename_role: {
        Args: { p_name: string; p_role: string }
        Returns: undefined
      }
      reveal_bank_account_number: { Args: never; Returns: string }
      set_bank_details: {
        Args: {
          p_account_number: string
          p_etransfer_email: string
          p_institution_number: string
          p_transit_number: string
        }
        Returns: undefined
      }
      set_module_enabled: {
        Args: { p_enabled: boolean; p_key: string }
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
      set_role_permission: {
        Args: { p_granted: boolean; p_permission_key: string; p_role: string }
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
      tax_rate_on: { Args: { p_date: string; p_tax: string }; Returns: number }
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

