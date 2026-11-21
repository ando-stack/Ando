"use client";

import { Activity, LayoutDashboard, LogOut, Menu, Plus, Settings2, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/players", label: "Jugadores", icon: Users },
  { href: "/matches", label: "Partidas", icon: Activity },
  { href: "/settings", label: "Sistema", icon: Settings2 },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 place-items-center rounded-lg bg-brand">
        <svg viewBox="0 0 24 24" className="size-4.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden>
          <path d="M5 4l7 16 7-16" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[14px] font-semibold tracking-tight">VOD Analyzer</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-3">Fortnite Coaching</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} onClick={() => setOpen(false)}
          className={cx("focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            active(href) ? "bg-surface-3 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink-2")}>
          <Icon className={cx("size-4", active(href) && "text-brand")} />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="px-2"><Logo /></div>
        <Link href="/matches/new" className="focus-ring mx-1 mt-6 mb-5 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white hover:bg-brand-strong">
          <Plus className="size-4" /> Nueva partida
        </Link>
        {nav}
        <div className="mt-auto border-t border-line px-2 pt-4">
          <div className="truncate text-sm font-medium">{user?.display_name}</div>
          <div className="truncate text-xs text-ink-3">{user?.email}</div>
          <button onClick={logout} className="focus-ring mt-3 flex items-center gap-2 rounded-md text-xs text-ink-3 hover:text-ink"><LogOut className="size-3.5" /> Cerrar sesión</button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <Link href="/matches/new" className="focus-ring grid size-9 place-items-center rounded-lg bg-brand text-white" aria-label="Nueva partida"><Plus className="size-4" /></Link>
          <button className="focus-ring grid size-9 place-items-center rounded-lg text-ink-2" onClick={() => setOpen(true)} aria-label="Menú"><Menu className="size-5" /></button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setOpen(false)}>
          <div className="fade-in absolute right-0 top-0 h-full w-72 border-l border-line bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between"><Logo /><button onClick={() => setOpen(false)} aria-label="Cerrar" className="text-ink-3"><X className="size-5" /></button></div>
            {nav}
            <button onClick={logout} className="mt-6 flex items-center gap-2 px-3 text-sm text-ink-3"><LogOut className="size-4" /> Cerrar sesión</button>
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
