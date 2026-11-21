export type Severity = "low" | "medium" | "high" | "critical";
export type Category =
  | "positioning" | "rotation" | "fight" | "endgame" | "decision"
  | "mechanics" | "materials" | "healing" | "survival" | "communication";
export type ErrorType = "mechanical" | "positioning" | "decision" | "strategy" | "communication";

export interface User { id: string; email: string; display_name: string | null }

export interface Player {
  id: string; name: string; epic_id: string | null; platform: string | null; region: string | null;
  game_mode: string | null; competitive_level: string | null; coach_notes: string | null;
  created_at: string; updated_at: string;
  matches?: number; last_score?: number | null; last_analysis_at?: string | null;
}

export interface Media {
  id: string; kind: "video" | "replay" | "proxy"; original_name: string; size_bytes: number; mime: string | null;
  duration_s: number | null; width: number | null; height: number | null; fps: number | null;
  video_codec: string | null; audio_codec: string | null; has_audio: boolean | null;
  meta: Record<string, unknown>; created_at: string;
}

export interface Job {
  id: string; type: string; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string | null; progress: number; message: string | null; error: string | null; error_code: string | null;
  attempts: number; created_at: string; started_at: string | null; finished_at: string | null;
}

export type MatchStatus = "draft" | "uploaded" | "queued" | "processing" | "completed" | "failed" | "incompatible";

export interface Match {
  id: string; player_id: string; player_name: string | null; title: string; source_type: "video" | "replay";
  status: MatchStatus; game_mode: string | null; played_at: string | null; notes: string | null;
  target_player_ref: string | null; replay_video_offset: number | null; created_at: string; updated_at: string;
  media?: Media[]; job?: Job | null; analysis?: { id: string; overall: number | null; created_at: string };
}

export interface Evidence { id: string; t: number; kind: string }

export interface Finding {
  id: string; origin: "ai" | "coach"; module: string | null; category: Category; error_type: ErrorType | null;
  severity: Severity; phase: "early" | "mid" | "end" | null; t_start: number; t_end: number | null; title: string;
  what_happened: string; why_error: string | null; what_to_do: string | null; how_to_avoid: string | null;
  evidence: Evidence[]; confidence: number | null; review_status: "open" | "confirmed" | "dismissed"; created_at: string;
}

export interface Note { id: string; t: number | null; category: string | null; text: string; created_at: string; updated_at: string }

export interface CategoryScore { label: string; score: number | null; reason?: string; penalty?: number; bonus?: number; findings: number }
export interface Scores {
  overall: number | null; analysed_minutes: number;
  categories: Record<string, CategoryScore>;
  methodology: { disclaimer: string; formula: string; notes: string[]; severity_weights: Record<Severity, number> };
}

export interface Report {
  match_summary: string; overall_evaluation: string; strengths: string[]; weaknesses: string[];
  top_errors: { ref: string; finding_id?: string; comment: string }[];
  early_game: string; mid_game: string; endgame: string; fights: string;
  recommendations: { title: string; detail: string; category: Category }[];
  drills: { name: string; goal: string; how: string; duration_minutes: number; category: Category }[];
  next_session_goals: { title: string; measurable_target: string; category: Category }[];
  limitations: string[];
  module_summaries?: Record<string, string>;
  not_assessable?: Record<string, string[]>;
  strengths_evidence?: { module: string; description: string; evidence: string[]; t: number }[];
}

export interface TimelineItem {
  id: string; kind: "frame" | "event" | "observation" | "speech" | "replay_event"; t: number; t_end?: number | null;
  type?: string; description?: string; text?: string; situation?: string; phase?: string;
  hud?: Record<string, number | string | null>; evidence?: string[]; frames?: string[]; category?: string; obs_kind?: string;
  players_alive_after?: number | null; confidence?: number;
}

export interface Analysis {
  id: string; source_type: "video" | "replay"; model: string | null; pipeline_version: string; created_at: string;
  coverage: Record<string, any>; stats: Record<string, any>; scores: Scores; report: Report; timeline: TimelineItem[];
  replay_data: { players: any[]; positions: { t: number; x: number; y: number }[]; zones: { t: number | null; x: number; y: number; r: number }[] } | null;
  usage: Record<string, any>;
}

export interface AnalysisBundle {
  analysis: Analysis | null;
  frames?: { label: string; t: number; reason: string; segment: number }[];
  findings: Finding[];
  notes: Note[];
}

export interface Goal {
  id: string; player_id: string; title: string; description: string | null; category: string | null;
  status: "pending" | "achieved" | "dropped"; due_date: string | null; source_analysis_id: string | null;
  created_at: string; completed_at: string | null;
}
