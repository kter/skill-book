import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@skill-book/shared"],
  images: { unoptimized: true },
};

export default nextConfig;
