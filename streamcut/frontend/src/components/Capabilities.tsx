"use client";

import { CheckCircle2, CircleSlash, KeyRound, Clock } from "lucide-react";
import type { Capabilities as Caps, CapabilityMode } from "@/lib/types";
import { Badge } from "./ui";

export const MODE_INFO: Record<CapabilityMode, { label: string; tone: "neutral" | "info" | "ok"; text: string }> = {
  VIEW_ONLY: { label: "Solo visualización", tone: "neutral",
    text: "Reproductor oficial, estado y metadatos. No se analiza audio ni vídeo." },
  PLATFORM_CLIPS: { label: "Clips de plataforma", tone: "info",
    text: "Se crean clips oficiales mediante la API cuando el chat detecta un momento." },
  FULL_ANALYSIS: { label: "Análisis completo", tone: "ok",
    text: "Señal autorizada: análisis de audio/vídeo en tiempo real y clips propios en MP4." },
};

export function ModeBadge({ mode }: { mode: CapabilityMode | undefined }) {
  if (!mode) return null;
  const m = MODE_INFO[mode];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

const ICON = {
  available: <CheckCircle2 className="h-4 w-4 text-ok" />,
  needs_permission: <KeyRound className="h-4 w-4 text-warn" />,
  unavailable: <CircleSlash className="h-4 w-4 text-faint" />,
  not_implemented: <Clock className="h-4 w-4 text-faint" />,
};
const LABEL = {
  available: "Operativa", needs_permission: "Necesita permisos", unavailable: "No disponible", not_implemented: "Pendiente",
};

export function CapabilityList({ caps, compact }: { caps: Caps | null | undefined; compact?: boolean }) {
  if (!caps) return null;
  return (
    <ul className="space-y-2">
      {caps.features.map((f) => (
        <li key={f.key} className="flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0">{ICON[f.status]}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg">
              {f.label}
              <span className="text-[10px] uppercase tracking-wider text-faint">{LABEL[f.status]}</span>
            </div>
            {!compact && <p className="text-xs leading-relaxed text-muted">{f.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
