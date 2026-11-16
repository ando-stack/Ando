export type Platform = "twitch" | "youtube";
export type CapabilityMode = "VIEW_ONLY" | "PLATFORM_CLIPS" | "FULL_ANALYSIS";
export type FeatureStatus = "available" | "needs_permission" | "unavailable" | "not_implemented";

export interface Me {
  id: string;
  email: string;
  display_name: string;
  workspace: { id: string; name: string; storage_quota_bytes: number };
}

export interface Feature { key: string; label: string; status: FeatureStatus; detail: string }
export interface Capabilities { mode: CapabilityMode; features: Feature[]; permission_issues: string[]; computed_at: string }

export interface StreamSessionT {
  id: string; status: "live" | "ended"; monitoring: boolean; capability_mode: CapabilityMode;
  started_at: string; ended_at: string | null; title: string | null; category: string | null;
  peak_viewers: number | null; analyzed_seconds: number; clips?: number;
}

export interface Channel {
  id: string; platform: Platform; display_name: string; status: "unknown" | "online" | "offline" | "error";
  title: string | null; category: string | null; viewer_count: number | null; live_started_at: string | null;
  live_video_id: string | null; external_id: string; platform_user_id: string | null; handle: string | null;
  url: string; avatar_url: string | null; is_tracked: boolean; priority: number; last_live_at: string | null;
  last_checked_at: string | null; last_error: string | null; created_at: string; default_template_id: string | null;
  autopilot: Record<string, unknown>; capabilities: Capabilities | null;
  source: null | { id: string; mode: "pull" | "listen"; status: string; last_error: string | null;
    rights_confirmed: boolean; listen_port: number | null; ingest_url: string | null };
  clips_count: number; session: StreamSessionT | null; created?: boolean; verified?: boolean; stream_key?: string;
}

export interface Job {
  id: string; kind: "ingestion" | "analysis" | "export"; status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stage: string | null; progress: number; error: string | null; attempts: number; created_at: string;
  started_at: string | null; finished_at: string | null; source_asset_id?: string; clip_id?: string;
  result?: Record<string, any>; title?: string | null;
}

export interface Candidate {
  id: string; start: number; end: number; peak_time: number; recommended_duration: number | null; score: number;
  scores: Record<string, number>; category: string; confidence: number; explanation: string;
  transcript_text: string | null; status: string; created_at: string;
}

export interface Asset {
  id: string; title: string; kind: string; status: string; filename: string | null; size_bytes: number;
  duration: number | null; width: number | null; height: number | null; fps: number | null; has_audio: boolean | null;
  created_at: string; deleted_at: string | null; streamer_name: string | null; game: string | null; has_chat: boolean;
  thumbnail_url: string | null; proxy_url: string | null; original_url: string; waveform_url: string | null;
  ingestion: Job | null; analysis: Job | null; clips: number; candidates?: Candidate[];
}

export type ClipStatus = "detected" | "pending" | "processing" | "editing" | "approved" | "rejected" | "exported" | "published";

export interface Clip {
  id: string; title: string; status: ClipStatus; origin: string; score: number | null; category: string | null;
  format: string; duration: number | null; start: number | null; end: number | null; is_favorite: boolean;
  streamer_name: string | null; platform: string | null; game: string | null; stream_time: string | null;
  created_at: string; updated_at: string; deleted_at: string | null; channel_id: string | null;
  source_asset_id: string | null; thumbnail_url: string | null; video_url: string | null; download_url: string | null;
  platform_clip_url: string | null; detection_latency_s: number | null; ready_latency_s: number | null;
  version: number | null; version_status: string | null; tags: string[]; collections: string[];
}

export interface ClipDetail extends Clip {
  candidate: Candidate | null; transcript_text: string | null; platform_data: Record<string, unknown>;
  versions: { id: string; version_no: number; status: string; note: string | null; created_at: string;
    video_url: string | null; thumbnail_url: string | null; duration: number | null; size_bytes: number | null;
    av_sync_diff: number | null; is_current: boolean }[];
  exports: Job[];
  source: null | { id: string; title: string; kind: string; duration: number | null; deleted: boolean };
}

export interface DetectedEvent {
  id: string; type: string; label: string; t_start: number | null; t_end: number | null; confidence: number | null;
  value: number | null; data: Record<string, unknown>; channel_id: string | null; stream_session_id: string | null;
  source_asset_id: string | null; created_at: string;
}

export interface Template {
  id: string; slug: string; name: string; description: string | null; is_builtin: boolean;
  spec: Record<string, any>; updated_at: string;
}

export interface Collection { id: string; name: string; description: string | null; clips: number; created_at: string }

// --- Especificación de edición (espejo de app/media/editspec.py) ---
export interface Region { x: number; y: number; w: number; h: number }
export interface Segment { start: number; end: number }
export interface Word { start: number; end: number; text: string }
export interface Cue { start: number; end: number; text: string; words: Word[] }
export interface SubtitleStyle {
  font: string; size: number; bold: boolean; uppercase: boolean; color: string; highlight_color: string;
  outline_color: string; outline: number; shadow: number; position: "bottom" | "middle" | "top"; margin_v: number;
  animation: "none" | "karaoke" | "pop"; words_per_line: number;
}
export interface EditSpec {
  version: number; source_asset_id: string; segments: Segment[]; format: "9:16" | "16:9" | "1:1";
  quality: "1080p" | "720p";
  layout: { mode: "fit_blur" | "crop" | "split" | "fit_black"; main: Region; webcam: Region | null; split_ratio: number };
  zoom: { enabled: boolean; punch_ins: { t: number; duration: number; scale: number }[] };
  subtitles: { enabled: boolean; style: SubtitleStyle; cues: Cue[] };
  audio: { normalize: boolean; target_lufs: number; limiter: boolean; denoise: boolean; gain_db: number };
  fades: { video_in: number; video_out: number };
  auto_edit: boolean;
}
