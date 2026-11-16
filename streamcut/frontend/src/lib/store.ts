import { create } from "zustand";
import type { DetectedEvent, Platform } from "./types";

export interface LiveStats {
  session_id: string; channel_id: string; status: string; mode: string; media_access: boolean;
  chat_messages: number; chat_connected: boolean; events: number; candidates: number; analyzed_seconds: number;
  buffer_seconds: number; platform_clips: number; note: string | null; uptime: number;
  resources: { cpu_percent?: number; mem_percent?: number; disk_free_gb?: number; disk_percent?: number; gpu?: string | null };
}

interface Toast { id: number; kind: "ok" | "error" | "info"; text: string }

interface AppState {
  platform: Platform;
  setPlatform: (p: Platform) => void;
  activeChannelId: string | null;
  setActiveChannel: (id: string | null) => void;
  sseConnected: boolean;
  setSse: (v: boolean) => void;
  recentEvents: DetectedEvent[];
  pushEvent: (e: DetectedEvent) => void;
  liveStats: Record<string, LiveStats>; // por channel_id
  setLiveStats: (s: LiveStats) => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;

export const useApp = create<AppState>((set) => ({
  platform: "twitch",
  setPlatform: (platform) => set({ platform }),
  activeChannelId: null,
  setActiveChannel: (activeChannelId) => set({ activeChannelId }),
  sseConnected: false,
  setSse: (sseConnected) => set({ sseConnected }),
  recentEvents: [],
  pushEvent: (e) => set((s) => ({ recentEvents: [e, ...s.recentEvents.filter((x) => x.id !== e.id)].slice(0, 200) })),
  liveStats: {},
  setLiveStats: (st) => set((s) => ({ liveStats: { ...s.liveStats, [st.channel_id]: st } })),
  toasts: [],
  toast: (text, kind = "info") => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
