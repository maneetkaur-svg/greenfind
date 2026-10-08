import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GreenFind — Vendor Management Tool',
  description: 'Internal vendor management tool for Fitsol',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Loaded by the browser rather than by next/font, so a slow or blocked
            Google Fonts request can never fail the build. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
