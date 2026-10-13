import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Server Actions default to a 1MB request body limit — far under the
  // 10MB per-file cap this app itself advertises everywhere a document is
  // uploaded (onboard form, the Add Vendor wizard, InlineDocUpload). A
  // small GST/PAN/cheque sails under 1MB and uploads fine; a multi-page
  // scanned CTO or EPR certificate routinely does not, and silently fails
  // in a way that looks like the upload hanging rather than a clear error.
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
};

export default nextConfig;
