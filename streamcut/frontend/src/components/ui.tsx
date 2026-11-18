"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/format";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg viewBox="0 0 64 64" className="h-8 w-8 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a78bfa" />
            <stop offset="1" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="#1b1e25" />
        <path d="M20 18h17l-7 12h14L25 48l5-14H18z" fill="url(#lg)" />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-semibold tracking-[0.08em] text-fg">STREAMCUT</div>
          <div className="mt-0.5 text-[10px] font-semibold tracking-[0.3em] text-accent-soft">AI</div>
        </div>
      )}
    </div>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, subtitle, action, icon }: {
  title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="text-accent-soft">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: {
  title: string; description?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-label="Cargando" />;
}

export function Empty({ icon, title, children, action }: {
  icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line px-6 py-14 text-center">
      {icon && <div className="rounded-xl bg-accent-bg p-3 text-accent-soft">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}

const TONES = {
  neutral: "border-line bg-panel-2 text-muted",
  accent: "border-accent/30 bg-accent-bg text-accent-soft",
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
  live: "border-live/40 bg-live/15 text-live",
  info: "border-info/30 bg-info/10 text-info",
} as const;

export function Badge({ tone = "neutral", children, className, dot }: {
  tone?: keyof typeof TONES; children: React.ReactNode; className?: string; dot?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", TONES[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full bg-current", tone === "live" && "animate-pulse-live")} />}
      {children}
    </span>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-panel-3", className)} role="progressbar"
      aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft transition-[width] duration-500"
        style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function ScoreRing({ score, size = 38 }: { score: number | null; size?: number }) {
  if (score === null || score === undefined) return null;
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 75 ? "var(--color-accent-soft)" : score >= 55 ? "var(--color-info)" : "var(--color-muted)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`Puntuación de interés: ${score}/100 (estimación, no probabilidad de viralidad)`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-panel-3)" strokeWidth="3" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="3" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums text-fg">{Math.round(score)}</span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!open || !mounted) return null;
  // Portal al <body>: así la ventana nunca queda atrapada dentro de una tarjeta con animación o overflow
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true"
        className={cn("card max-h-[92dvh] w-full overflow-auto outline-none shadow-2xl", wide ? "max-w-5xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button className="btn-icon" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm", disabled && "opacity-50 pointer-events-none")}>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-panel-3 border border-line")}>
        <span className={cn("absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
      {label && <span className="text-fg">{label}</span>}
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, className, ariaLabel }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; ariaLabel?: string;
}) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className={cn("input pr-8", className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        {icon && <span className="text-faint">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </Card>
  );
}

export function PlatformTag({ platform }: { platform: string | null | undefined }) {
  if (!platform) return null;
  const tw = platform === "twitch";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
      tw ? "bg-[#9146ff]/15 text-[#b18cff]" : "bg-[#ff0033]/12 text-[#ff6b81]")}>
      {tw ? "Twitch" : "YouTube"}
    </span>
  );
}
