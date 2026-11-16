/** @type {import('next').NextConfig} */
// Exportación estática: Netlify (o cualquier hosting) solo sirve HTML/JS; el backend vive aparte.
// Las cabeceras de seguridad se definen en netlify.toml.
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: true,
};
export default nextConfig;
