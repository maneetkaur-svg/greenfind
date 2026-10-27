'use client';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'greenfind-theme';

/** Icon-only light/dark switch. The actual color values live in
 *  globals.css under :root[data-theme="dark"] — this only ever sets that
 *  one attribute on <html> and remembers the choice, it owns no colors
 *  itself beyond the green the icon is drawn in. See app/layout.tsx for
 *  the inline script that applies the saved choice before first paint. */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark');
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    try { localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light'); } catch { /* ignored */ }
  };

  return (
    <button type="button" onClick={toggle}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="grid place-items-center rounded-full"
            style={{ width: 32, height: 32, color: 'var(--p600)', background: 'var(--surface-2)',
                     border: '1px solid var(--line)', cursor: 'pointer', flexShrink: 0 }}>
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.55 1.55M18.25 18.25l1.55 1.55M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.55-1.55M18.25 5.75l1.55-1.55" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 14.2a8.5 8.5 0 1 1-10.7-10.7 7 7 0 0 0 10.7 10.7Z" />
        </svg>
      )}
    </button>
  );
}
