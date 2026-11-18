"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Bot, Clapperboard, Film, LayoutDashboard, LayoutTemplate, Library, LogOut, Radio, Settings,
  Sparkles, Tv, Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api, ApiError, post } from "@/lib/api";
import { useServerEvents } from "@/lib/events";
import { cn } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Me } from "@/lib/types";
import { Logo, Spinner } from "./ui";
import { Toaster } from "./Toaster";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/", label: "Directos", icon: Radio },
  { href: "/channels", label: "Canales", icon: Tv },
  { href: "/import", label: "Importar vídeo", icon: Upload },
  { href: "/clips", label: "Clips", icon: Clapperboard },
  { href: "/library", label: "Biblioteca", icon: Library },
  { href: "/ai-editor", label: "Editor IA", icon: Sparkles },
  { href: "/editor", label: "Editor manual", icon: Film },
  { href: "/templates", label: "Plantillas", icon: LayoutTemplate },
  { href: "/automations", label: "Automatizaciones", icon: Bot },
  { href: "/stats", label: "Estadísticas", icon: BarChart3 },
  { href: "/settings", label: "Configuración", icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useQuery<Me, ApiError>({ queryKey: ["me"], queryFn: () => api<Me>("/auth/me"), retry: false, staleTime: 60_000 });
  const sse = useApp((s) => s.sseConnected);
  useServerEvents(me.isSuccess);

  useEffect(() => {
    if (me.error?.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.error, router, pathname]);
  useEffect(() => {
    const h = () => router.replace("/login");
    window.addEventListener("streamcut:unauthorized", h);
    return () => window.removeEventListener("streamcut:unauthorized", h);
  }, [router]);

  if (!me.isSuccess) {
    return <div className="grid min-h-dvh place-items-center text-muted"><Spinner className="h-6 w-6" /></div>;
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-panel/60 px-3 py-4 lg:flex">
        <div className="px-2 pb-6"><Logo /></div>
        <nav className="flex-1 space-y-0.5" aria-label="Principal">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={cn("group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                isActive(href) ? "bg-accent-bg text-fg" : "text-muted hover:bg-panel-2 hover:text-fg")}>
              <Icon className={cn("h-4 w-4", isActive(href) ? "text-accent-soft" : "text-faint group-hover:text-muted")} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 space-y-3 border-t border-line px-2 pt-4">
          <div className="flex items-center gap-2 text-[11px] text-faint">
            <span className={cn("h-1.5 w-1.5 rounded-full", sse ? "bg-ok" : "bg-warn animate-pulse-live")} />
            {sse ? "Tiempo real conectado" : "Reconectando…"}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-fg">{me.data.display_name}</div>
              <div className="truncate text-[11px] text-faint">{me.data.email}</div>
            </div>
            <button className="btn-icon" aria-label="Cerrar sesión" title="Cerrar sesión"
              onClick={async () => { await post("/auth/logout"); router.replace("/login"); }}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      {/* Navegación compacta en pantallas pequeñas */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line bg-panel/95 py-1.5 backdrop-blur lg:hidden">
        {NAV.filter((n) => ["/", "/channels", "/import", "/library", "/settings"].includes(n.href)).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn("flex flex-col items-center gap-0.5 px-2 py-1 text-[10px]", isActive(href) ? "text-accent-soft" : "text-muted")}>
            <Icon className="h-4 w-4" />{label.split(" ")[0]}
          </Link>
        ))}
      </div>
      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10">
        <div className="mx-auto max-w-[1600px] animate-fade-in">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}

