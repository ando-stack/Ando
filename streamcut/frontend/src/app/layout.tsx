import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "STREAMCUT AI", template: "%s · STREAMCUT AI" },
  description: "Monitoriza directos, detecta momentos destacados y crea clips automáticamente con IA.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#0d0e11", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
