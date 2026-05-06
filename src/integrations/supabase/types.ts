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
      match_aftermatch: {
        Row: {
          expires_at: string
          generated_at: string
          match_id: string
          payload: Json
        }
        Insert: {
          expires_at: string
          generated_at?: string
          match_id: string
          payload: Json
        }
        Update: {
          expires_at?: string
          generated_at?: string
          match_id?: string
          payload?: Json
        }
        Relationships: []
      }
      match_insights: {
        Row: {
          expires_at: string
          generated_at: string
          match_id: string
          payload: Json
        }
        Insert: {
          expires_at: string
          generated_at?: string
          match_id: string
          payload: Json
        }
        Update: {
          expires_at?: string
          generated_at?: string
          match_id?: string
          payload?: Json
        }
        Relationships: []
      }
      model_lessons: {
        Row: {
          adjustment_signal: string | null
          category: string
          confidence_impact: number
          created_at: string
          id: string
          lesson: string
          match_id: string
        }
        Insert: {
          adjustment_signal?: string | null
          category: string
          confidence_impact?: number
          created_at?: string
          id?: string
          lesson: string
          match_id: string
        }
        Update: {
          adjustment_signal?: string | null
          category?: string
          confidence_impact?: number
          created_at?: string
          id?: string
          lesson?: string
          match_id?: string
        }
        Relationships: []
      }
      news_model_impacts: {
        Row: {
          active: boolean
          added_by_user: boolean
          adjustment_summary: string | null
          article_id: string
          created_at: string
          expires_at: string | null
          fixtures_affected: Json
          id: string
          impact_area: string
          impact_strength: string
          impact_type: string
          model_adjustment: string | null
          players_affected: Json
          published_at: string | null
          source: string | null
          teams_affected: Json
          title: string
          url: string
        }
        Insert: {
          active?: boolean
          added_by_user?: boolean
          adjustment_summary?: string | null
          article_id: string
          created_at?: string
          expires_at?: string | null
          fixtures_affected?: Json
          id?: string
          impact_area: string
          impact_strength?: string
          impact_type: string
          model_adjustment?: string | null
          players_affected?: Json
          published_at?: string | null
          source?: string | null
          teams_affected?: Json
          title: string
          url: string
        }
        Update: {
          active?: boolean
          added_by_user?: boolean
          adjustment_summary?: string | null
          article_id?: string
          created_at?: string
          expires_at?: string | null
          fixtures_affected?: Json
          id?: string
          impact_area?: string
          impact_strength?: string
          impact_type?: string
          model_adjustment?: string | null
          players_affected?: Json
          published_at?: string | null
          source?: string | null
          teams_affected?: Json
          title?: string
          url?: string
        }
        Relationships: []
      }
      odds_cache: {
        Row: {
          cache_key: string
          expires_at: string
          generated_at: string
          payload: Json
        }
        Insert: {
          cache_key: string
          expires_at: string
          generated_at?: string
          payload: Json
        }
        Update: {
          cache_key?: string
          expires_at?: string
          generated_at?: string
          payload?: Json
        }
        Relationships: []
      }
      prediction_results: {
        Row: {
          actual_first_try_scorer: string | null
          actual_htft: string | null
          actual_margin_band: string | null
          actual_score_away: number | null
          actual_score_home: number | null
          actual_total_points: number | null
          actual_total_result: string | null
          actual_try_order: Json
          actual_try_scorers: Json
          actual_winner: string | null
          completed_at: string
          id: string
          match_id: string
          player_stats: Json | null
          team_stats: Json | null
        }
        Insert: {
          actual_first_try_scorer?: string | null
          actual_htft?: string | null
          actual_margin_band?: string | null
          actual_score_away?: number | null
          actual_score_home?: number | null
          actual_total_points?: number | null
          actual_total_result?: string | null
          actual_try_order?: Json
          actual_try_scorers?: Json
          actual_winner?: string | null
          completed_at?: string
          id?: string
          match_id: string
          player_stats?: Json | null
          team_stats?: Json | null
        }
        Update: {
          actual_first_try_scorer?: string | null
          actual_htft?: string | null
          actual_margin_band?: string | null
          actual_score_away?: number | null
          actual_score_home?: number | null
          actual_total_points?: number | null
          actual_total_result?: string | null
          actual_try_order?: Json
          actual_try_scorers?: Json
          actual_winner?: string | null
          completed_at?: string
          id?: string
          match_id?: string
          player_stats?: Json | null
          team_stats?: Json | null
        }
        Relationships: []
      }
      prediction_scores: {
        Row: {
          anytime_checked: number
          anytime_hit_rate: number | null
          anytime_hits: number
          created_at: string
          first_try_correct: boolean | null
          htft_correct: boolean | null
          id: string
          margin_correct: boolean | null
          match_id: string
          player_market_score: number | null
          risk_tier: string | null
          script_accuracy: number | null
          secondary_checked: number
          secondary_hits: number
          team_market_score: number | null
          total_correct: boolean | null
          total_model_score: number | null
          winner_correct: boolean | null
        }
        Insert: {
          anytime_checked?: number
          anytime_hit_rate?: number | null
          anytime_hits?: number
          created_at?: string
          first_try_correct?: boolean | null
          htft_correct?: boolean | null
          id?: string
          margin_correct?: boolean | null
          match_id: string
          player_market_score?: number | null
          risk_tier?: string | null
          script_accuracy?: number | null
          secondary_checked?: number
          secondary_hits?: number
          team_market_score?: number | null
          total_correct?: boolean | null
          total_model_score?: number | null
          winner_correct?: boolean | null
        }
        Update: {
          anytime_checked?: number
          anytime_hit_rate?: number | null
          anytime_hits?: number
          created_at?: string
          first_try_correct?: boolean | null
          htft_correct?: boolean | null
          id?: string
          margin_correct?: boolean | null
          match_id?: string
          player_market_score?: number | null
          risk_tier?: string | null
          script_accuracy?: number | null
          secondary_checked?: number
          secondary_hits?: number
          team_market_score?: number | null
          total_correct?: boolean | null
          total_model_score?: number | null
          winner_correct?: boolean | null
        }
        Relationships: []
      }
      prediction_snapshots: {
        Row: {
          anytime_try_picks: Json
          away_team: string
          confidence_scores: Json | null
          created_at: string
          data_sources: Json | null
          first_try_pick: string | null
          home_team: string
          id: string
          kickoff_utc: string | null
          locked_before_kickoff: boolean
          match_id: string
          model_mode: string
          odds_snapshot: Json | null
          predicted_htft: string | null
          predicted_margin_band: string | null
          predicted_score_away: number | null
          predicted_score_home: number | null
          predicted_total_lean: string | null
          predicted_total_line: number | null
          predicted_winner: string | null
          round: number | null
          script_prediction: Json | null
          season: number | null
          secondary_tier_picks: Json
        }
        Insert: {
          anytime_try_picks?: Json
          away_team: string
          confidence_scores?: Json | null
          created_at?: string
          data_sources?: Json | null
          first_try_pick?: string | null
          home_team: string
          id?: string
          kickoff_utc?: string | null
          locked_before_kickoff?: boolean
          match_id: string
          model_mode: string
          odds_snapshot?: Json | null
          predicted_htft?: string | null
          predicted_margin_band?: string | null
          predicted_score_away?: number | null
          predicted_score_home?: number | null
          predicted_total_lean?: string | null
          predicted_total_line?: number | null
          predicted_winner?: string | null
          round?: number | null
          script_prediction?: Json | null
          season?: number | null
          secondary_tier_picks?: Json
        }
        Update: {
          anytime_try_picks?: Json
          away_team?: string
          confidence_scores?: Json | null
          created_at?: string
          data_sources?: Json | null
          first_try_pick?: string | null
          home_team?: string
          id?: string
          kickoff_utc?: string | null
          locked_before_kickoff?: boolean
          match_id?: string
          model_mode?: string
          odds_snapshot?: Json | null
          predicted_htft?: string | null
          predicted_margin_band?: string | null
          predicted_score_away?: number | null
          predicted_score_home?: number | null
          predicted_total_lean?: string | null
          predicted_total_line?: number | null
          predicted_winner?: string | null
          round?: number | null
          script_prediction?: Json | null
          season?: number | null
          secondary_tier_picks?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
