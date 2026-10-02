import { DEV_AUTH_BYPASS } from '@/lib/devAuth';

/** Unmissable while the bypass is on, and renders nothing otherwise.
 *  It exists so nobody mistakes a bypassed session for a real one. */
export default function DevBanner() {
  if (!DEV_AUTH_BYPASS) return null;
  return (
    <div style={{ background: 'var(--warn-l)', color: 'var(--warn-d)',
                  borderBottom: '1px solid rgba(234,179,8,.4)', fontSize: 12.5 }}>
      <div className="max-w-[1240px] mx-auto px-5 py-1.5">
        <b>DEV AUTH BYPASS</b> — login is off and this session is a Super Admin.
        Local development only; it cannot switch on in a production build or on Vercel.
      </div>
    </div>
  );
}
