/** @type {import('next').NextConfig} */
const nextConfig = {
  // The pages read fixtures and the registry from disk at request time. Those files are never
  // imported, so Next's tracing cannot infer them: name them explicitly or a deploy 500s on ENOENT.
  outputFileTracingIncludes: {
    "/": ["./demo/fixtures/**", "./demo/cases.json", "./registry/**"],
    "/arena": ["./demo/fixtures/**", "./demo/cases.json", "./registry/**"],
  },
};

export default nextConfig;
