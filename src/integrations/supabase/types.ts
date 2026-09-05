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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_notes: {
        Row: {
          admin_id: string
          created_at: string
          id: string
          note: string
          user_id: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: string
          note: string
          user_id: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: string
          note?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          created_at: string
          id: string
          ip_address: string | null
          resource: string | null
          result: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          resource?: string | null
          result?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          resource?: string | null
          result?: string | null
        }
        Relationships: []
      }
      devices: {
        Row: {
          browser: string | null
          created_at: string
          device_key: string
          device_name: string | null
          device_type: string | null
          id: string
          last_ip: string | null
          last_seen: string
          os: string | null
          trusted: boolean
          user_id: string
        }
        Insert: {
          browser?: string | null
          created_at?: string
          device_key: string
          device_name?: string | null
          device_type?: string | null
          id?: string
          last_ip?: string | null
          last_seen?: string
          os?: string | null
          trusted?: boolean
          user_id: string
        }
        Update: {
          browser?: string | null
          created_at?: string
          device_key?: string
          device_name?: string | null
          device_type?: string | null
          id?: string
          last_ip?: string | null
          last_seen?: string
          os?: string | null
          trusted?: boolean
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_locked: boolean
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          flagged_for_review: boolean
          full_name: string | null
          id: string
          last_lat: number | null
          last_lng: number | null
          last_location_at: string | null
          last_location_label: string | null
          location_accuracy: number | null
          location_consent: boolean
          location_consent_at: string | null
          mobile: string | null
          postal_code: string | null
          require_password_reset: boolean
          state: string | null
          updated_at: string
        }
        Insert: {
          account_locked?: boolean
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          flagged_for_review?: boolean
          full_name?: string | null
          id: string
          last_lat?: number | null
          last_lng?: number | null
          last_location_at?: string | null
          last_location_label?: string | null
          location_accuracy?: number | null
          location_consent?: boolean
          location_consent_at?: string | null
          mobile?: string | null
          postal_code?: string | null
          require_password_reset?: boolean
          state?: string | null
          updated_at?: string
        }
        Update: {
          account_locked?: boolean
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          flagged_for_review?: boolean
          full_name?: string | null
          id?: string
          last_lat?: number | null
          last_lng?: number | null
          last_location_at?: string | null
          last_location_label?: string | null
          location_accuracy?: number | null
          location_consent?: boolean
          location_consent_at?: string | null
          mobile?: string | null
          postal_code?: string | null
          require_password_reset?: boolean
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      security_alerts: {
        Row: {
          category: string
          created_at: string
          description: string | null
          event_id: string | null
          id: string
          read: boolean
          severity: string
          title: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          read?: boolean
          severity?: string
          title: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          read?: boolean
          severity?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_alerts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "security_events"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          browser: string | null
          created_at: string
          device_type: string | null
          event_type: string
          id: string
          ip_address: string | null
          latitude: number | null
          location_label: string | null
          longitude: number | null
          metadata: Json
          os: string | null
          risk_level: string
          risk_reasons: string[]
          risk_score: number
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          browser?: string | null
          created_at?: string
          device_type?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          latitude?: number | null
          location_label?: string | null
          longitude?: number | null
          metadata?: Json
          os?: string | null
          risk_level?: string
          risk_reasons?: string[]
          risk_score?: number
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          browser?: string | null
          created_at?: string
          device_type?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          latitude?: number | null
          location_label?: string | null
          longitude?: number | null
          metadata?: Json
          os?: string | null
          risk_level?: string
          risk_reasons?: string[]
          risk_score?: number
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      security_risk_assessments: {
        Row: {
          generated_at: string
          id: string
          notes: string | null
          reasons: string[]
          review_status: string
          reviewed_by_admin_id: string | null
          risk_level: string
          score: number
          user_id: string
        }
        Insert: {
          generated_at?: string
          id?: string
          notes?: string | null
          reasons?: string[]
          review_status?: string
          reviewed_by_admin_id?: string | null
          risk_level?: string
          score?: number
          user_id: string
        }
        Update: {
          generated_at?: string
          id?: string
          notes?: string | null
          reasons?: string[]
          review_status?: string
          reviewed_by_admin_id?: string | null
          risk_level?: string
          score?: number
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
