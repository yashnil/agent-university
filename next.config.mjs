/** @type {import('next').NextConfig} */
const nextConfig = {
  // The demo reads fixtures from the repo at request time (node fs), so pages stay dynamic.
  experimental: {},
  // Those reads use computed paths, which file tracing cannot see: ship the data with every
  // server route (Vercel runs from /var/task, where only traced files exist).
  outputFileTracingIncludes: {
    "/**": ["./demo/**/*", "./schemas/**/*", "./registry/**/*"],
  },
};

export default nextConfig;
