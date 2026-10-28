import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GreenFind — Vendor Management Tool',
  description: 'Internal vendor management tool for Fitsol',
};

// The dark-mode script below sets data-theme on <html> before React
// hydrates (that's the whole point — no flash of the wrong theme), which
// otherwise reads to React as a server/client mismatch on that one node.
// suppressHydrationWarning tells it that's expected there, without
// silencing mismatches anywhere else in the tree.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Loaded by the browser rather than by next/font, so a slow or blocked
            Google Fonts request can never fail the build. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        {/* Applied before first paint, so a saved dark-mode choice never
            flashes light first. No inline styles are set here — only the
            attribute globals.css keys its dark overrides off of. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('greenfind-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
