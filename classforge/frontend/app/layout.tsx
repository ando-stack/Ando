import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClassForge AI",
  description: "Sube los documentos de tu profesor y obtén los archivos del trabajo realizados, editables y verificados.",
};

export const viewport: Viewport = { themeColor: "#0b0c10", width: "device-width", initialScale: 1 };

// Aplica el tema guardado antes de pintar para evitar parpadeos (oscuro por defecto).
const themeScript = `try{var p=JSON.parse(localStorage.getItem('cf_prefs')||'{}');if(p.theme!=='light')document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans" style={{ ["--font-sans" as string]: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
