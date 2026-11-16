"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApp, type LiveStats } from "./store";
import type { DetectedEvent } from "./types";

/** Conexión SSE única: refresca las consultas afectadas en cuanto el backend publica un cambio. */
export function useServerEvents(enabled: boolean) {
  const qc = useQueryClient();
  const { setSse, pushEvent, setLiveStats } = useApp.getState();

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const debounce = (key: string, fn: () => void, ms = 400) => {
      if (timers.has(key)) return;
      timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, ms));
    };

    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => setSse(true);
      es.onerror = () => {
        setSse(false);
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
      es.onmessage = (msg) => {
        let ev: { type: string; data: any };
        try { ev = JSON.parse(msg.data); } catch { return; }
        switch (ev.type) {
          case "job":
            qc.setQueriesData({ queryKey: ["jobs"] }, (old: any) =>
              Array.isArray(old) ? old.map((j) => (j.id === ev.data.id ? { ...j, ...ev.data } : j)) : old);
            debounce("jobs", () => qc.invalidateQueries({ queryKey: ["jobs"] }), 1200);
            if (["succeeded", "failed", "cancelled"].includes(ev.data.status)) {
              debounce("assets", () => qc.invalidateQueries({ queryKey: ["assets"] }));
              debounce("stats", () => qc.invalidateQueries({ queryKey: ["stats"] }));
            }
            break;
          case "asset":
            debounce("assets", () => qc.invalidateQueries({ queryKey: ["assets"] }));
            break;
          case "clip":
            debounce("clips", () => { qc.invalidateQueries({ queryKey: ["clips"] }); qc.invalidateQueries({ queryKey: ["clip"] }); });
            debounce("live-status", () => qc.invalidateQueries({ queryKey: ["live-status"] }));
            break;
          case "candidates":
            debounce("assets", () => qc.invalidateQueries({ queryKey: ["assets"] }));
            break;
          case "detection":
            pushEvent(ev.data as DetectedEvent);
            debounce("live-events", () => qc.invalidateQueries({ queryKey: ["live-events"] }), 800);
            break;
          case "channel":
            debounce("channels", () => qc.invalidateQueries({ queryKey: ["channels"] }));
            break;
          case "live_stats":
            setLiveStats(ev.data as LiveStats);
            break;
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      timers.forEach(clearTimeout);
      es?.close();
      setSse(false);
    };
  }, [enabled, qc, setSse, pushEvent, setLiveStats]);
}
