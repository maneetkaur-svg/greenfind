import { DEV_AUTH_BYPASS, devMode, devStatus } from '@/lib/devAuth';

/** Unmissable while the bypass is on, and renders nothing otherwise.
 *  It exists so nobody mistakes a bypassed session for a real one. */
export default function DevBanner() {
  if (!DEV_AUTH_BYPASS) return null;
  const mode = devMode();
  const risky = mode === 'service';
  return (
    <div style={{
      background: risky ? 'var(--err-l)' : 'var(--warn-l)',
      color: risky ? '#7F1D1D' : 'var(--warn-d)',
      borderBottom: '1px solid ' + (risky ? 'rgba(239,68,68,.4)' : 'rgba(234,179,8,.4)'),
      fontSize: 12.5,
    }}>
      <div className="max-w-[1240px] mx-auto px-5 py-1.5">
        <b>DEV AUTH BYPASS</b> — {devStatus()}.
        {risky && ' Everything behaves as Super Admin, so role restrictions are not being tested.'}
        {' '}Local development only; it cannot switch on in a production build or on Vercel.
      </div>
    </div>
  );
}
