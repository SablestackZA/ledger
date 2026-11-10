import type { NextConfig } from "next";

const config: NextConfig = {
  // The write-up reads loadtest/reports/*.json and the migration at render time; Vercel only ships traced files.
  outputFileTracingIncludes: { "/": ["./loadtest/reports/**/*.json", "./db/migrations/*.sql"] },
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
