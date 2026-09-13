import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@tensorflow/tfjs", "@vladmandic/face-api"],
};

export default nextConfig;
