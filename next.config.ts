import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Tauri - static site generation
  output: 'export',
  
  // Required for static export
  images: {
    unoptimized: true
  },
  
  // Disable trailing slash for cleaner URLs
  trailingSlash: false,
};

export default nextConfig;
