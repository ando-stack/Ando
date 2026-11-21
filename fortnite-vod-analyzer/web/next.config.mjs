/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_PROXY_URL; // e.g. http://127.0.0.1:8000 -> serve the API under /backend (single public URL)

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  async rewrites() {
    return backend ? [{ source: "/backend/:path*", destination: `${backend.replace(/\/$/, "")}/:path*` }] : [];
  },
};
export default nextConfig;
