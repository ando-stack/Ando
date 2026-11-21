"use client";

import { Loader2, X } from "lucide-react";
import { forwardRef, useEffect } from "react";
import { SEVERITY_COLOR, SEVERITY_LABEL, scoreTone } from "@/lib/format";
import type { Severity } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref,
) {
  const base = "focus-ring inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap";
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm" };
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-strong",
    secondary: "bg-surface-3 text-ink border border-line hover:border-line-strong hover:bg-[#222735]",
    ghost: "text-ink-2 hover:text-ink hover:bg-surface-3",
    danger: "bg-transparent text-sev-critical border border-[#4a2327] hover:bg-[#2a1416]",
  };
  return (
    <button ref={ref} disabled={disabled || loading} className={cx(base, sizes[size], variants[variant], className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-xl border border-line bg-surface", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx("focus-ring h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-3 hover:border-line-strong", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx("focus-ring w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-3 hover:border-line-strong", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("focus-ring h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink hover:border-line-strong", className)} {...rest}>{children}</select>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "brand" | "ok" | "warn" | "danger"; className?: string }) {
  const tones = {
    neutral: "bg-surface-3 text-ink-2 border-line",
    brand: "bg-brand-soft text-[#8fb6ff] border-[#1d3766]",
    ok: "bg-[#0f2a1c] text-ok border-[#1c4a31]",
    warn: "bg-[#2b2210] text-sev-medium border-[#4a3a17]",
    danger: "bg-[#2a1416] text-sev-critical border-[#4a2327]",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}>{children}</span>;
}

export function SeverityBadge({ s }: { s: Severity }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
      <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
      {SEVERITY_LABEL[s]}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-ink-3", className)} />;
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return <div className="flex items-center gap-3 py-16 text-sm text-ink-3"><Spinner /> {label}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-[#4a2327] bg-[#1a0d0f] px-4 py-3 text-sm text-[#ffb3b6]">
      <span>{message}</span>
      {onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid size-11 place-items-center rounded-xl border border-line bg-surface-2 text-ink-3">{icon}</div>}
      <div className="font-medium">{title}</div>
      {text && <p className="mt-1 max-w-md text-sm text-ink-3">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={cx("fade-in max-h-[92vh] w-full overflow-auto rounded-t-2xl border border-line bg-surface sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-lg")} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button className="focus-ring rounded-md p-1 text-ink-3 hover:text-ink" onClick={onClose} aria-label="Cerrar"><X className="size-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ScoreRing({ score, size = 112, label }: { score: number | null | undefined; size?: number; label?: string }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const v = score ?? 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={6} />
        {score != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-brand)" strokeWidth={6} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: "stroke-dashoffset 700ms ease" }} />
        )}
      </svg>
      <div className="absolute text-center">
        <div className={cx("tabular text-[28px] font-semibold leading-none tracking-tight", scoreTone(score))} style={{ fontSize: size * 0.27 }}>{score ?? "—"}</div>
        {label && <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-3">{label}</div>}
      </div>
    </div>
  );
}

export function ScoreBar({ score }: { score: number | null | undefined }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      {score != null && <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${score}%` }} />}
    </div>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between text-[12px] font-medium uppercase tracking-wider text-ink-3">
        {label}
        {icon && <span className="text-ink-3">{icon}</span>}
      </div>
      <div className="tabular mt-2 text-[28px] font-semibold leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-2 text-xs text-ink-3">{hint}</div>}
    </Card>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cx("focus-ring -mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
            value === it.value ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink-2")}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
