import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = path.dirname(fileURLToPath(import.meta.url));
const faceApiBrowser = path.join(
  root,
  "node_modules/@vladmandic/face-api/dist/face-api.esm.js",
);

const nextConfig: NextConfig = {
  agentRules: false,
  turbopack: {
    resolveAlias: {
      "@vladmandic/face-api": faceApiBrowser,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@vladmandic/face-api": faceApiBrowser,
    };
    return config;
  },
};

export default nextConfig;
