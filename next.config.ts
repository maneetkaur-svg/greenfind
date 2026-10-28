import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Server Actions default to a 1MB request body limit. Raising it here only
  // matters for local dev, though -- in production this app runs on Vercel,
  // where every Server Action is a Vercel Function, and Vercel enforces its
  // own hard 4.5MB request-body ceiling at the platform level, ahead of
  // whatever is set here, on every plan, with no config override. A file
  // over that limit never reaches this app's code at all -- it comes back
  // as a raw 413 from Vercel's edge, which shows up to the user as a hard,
  // generic crash page, not a clear error (see lib/fileUpload.ts, which is
  // why every document upload's own client-side size check is kept safely
  // under 4.5MB, not just under whatever is set here). Matched to that same
  // cap so local dev behaves the same way production actually does.
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;
