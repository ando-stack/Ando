import type { NextConfig } from "next";

const backend = process.env.STREAMCUT_BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El navegador solo habla con Next; /api/* se reenvía al backend FastAPI (mismo origen → cookies seguras).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  compress: false, // no comprimir: el SSE de /api/events debe llegar sin búfer
};

export default nextConfig;
