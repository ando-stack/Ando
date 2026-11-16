"use client";

import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get } from "@/lib/api";

export interface Dashboard {
  channels_monitored: number; channels_total: number; channels_live: number; streams_analyzed: number; streams_total: number;
  hours_processed: number; videos_imported: number; candidates: number; clips_created: number; clips_approved: number;
  clips_exported: number; avg_analysis_seconds: number | null; avg_render_seconds: number | null;
  avg_live_latency_seconds: number | null; storage_used_bytes: number; storage_quota_bytes: number; jobs_active: number;
  workers: { id: string; kind: string; hostname: string; last_seen_at: string; alive: boolean; info: Record<string, any> }[];
  recent_errors: { id: string; job_type: string; message: string; created_at: string }[];
}

export function ActivityChart() {
  const ts = useQuery({ queryKey: ["stats", "ts", 30], queryFn: () => get<{ daily: { date: string; clips: number; candidates: number }[] }>("/stats/timeseries?days=30") });
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <AreaChart data={ts.data?.daily ?? []} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b5cf6" stopOpacity={0.45} /><stop offset="1" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid stroke="#2a2e38" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#636a7a", fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: "#636a7a", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#1b1e25", border: "1px solid #2a2e38", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#9097a7" }} />
          <Area type="monotone" dataKey="candidates" name="Candidatos" stroke="#38bdf8" fill="transparent" strokeWidth={1.5} />
          <Area type="monotone" dataKey="clips" name="Clips" stroke="#a78bfa" fill="url(#gc)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

