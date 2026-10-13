import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vinext checks multipart requests before dispatching route handlers. Match
  // the upload endpoint's bounded batch size so scanned PDFs reach that handler.
  experimental: { serverActions: { bodySizeLimit: '22mb' } },
};

export default nextConfig;
