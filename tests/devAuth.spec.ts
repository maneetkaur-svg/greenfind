import { test, expect } from '@playwright/test';

/** The guard and the mode selection, checked without a browser or a database.
 *  These are the assertions that keep the bypass out of production. */

const guard = (env: Record<string, string | undefined>) =>
  env.NODE_ENV !== 'production' && !env.VERCEL && env.DEV_AUTH_BYPASS === 'true';

const mode = (env: Record<string, string | undefined>) => {
  if (!guard(env)) return 'none';
  if (env.DEV_AUTH_EMAIL && env.DEV_AUTH_PASSWORD) return 'session';
  if (env.SUPABASE_SERVICE_ROLE_KEY) return 'service';
  return 'none';
};

test.describe('production safeguard', () => {
  test('on in local development when asked for', () => {
    expect(guard({ NODE_ENV: 'development', DEV_AUTH_BYPASS: 'true' })).toBe(true);
  });

  test('off unless explicitly asked for', () => {
    expect(guard({ NODE_ENV: 'development' })).toBe(false);
    expect(guard({ NODE_ENV: 'development', DEV_AUTH_BYPASS: 'false' })).toBe(false);
    expect(guard({ NODE_ENV: 'development', DEV_AUTH_BYPASS: '1' })).toBe(false);
    expect(guard({ NODE_ENV: 'development', DEV_AUTH_BYPASS: 'TRUE' })).toBe(false);
  });

  test('off in a production build, whatever the flag says', () => {
    expect(guard({ NODE_ENV: 'production', DEV_AUTH_BYPASS: 'true' })).toBe(false);
  });

  test('off on Vercel, whatever the flag says', () => {
    expect(guard({ NODE_ENV: 'development', VERCEL: '1', DEV_AUTH_BYPASS: 'true' })).toBe(false);
  });

  test('off on a Vercel preview, which is the dangerous case', () => {
    expect(guard({ NODE_ENV: 'development', VERCEL: '1',
                   VERCEL_ENV: 'preview', DEV_AUTH_BYPASS: 'true' })).toBe(false);
  });

  test('the service key alone cannot switch it on', () => {
    expect(guard({ NODE_ENV: 'development', SUPABASE_SERVICE_ROLE_KEY: 'eyJ...' })).toBe(false);
  });
});

test.describe('mode selection', () => {
  const on = { NODE_ENV: 'development', DEV_AUTH_BYPASS: 'true' };

  test('a real account is preferred over the service key', () => {
    expect(mode({ ...on, DEV_AUTH_EMAIL: 'a@b.com', DEV_AUTH_PASSWORD: 'x',
                  SUPABASE_SERVICE_ROLE_KEY: 'eyJ...' })).toBe('session');
  });

  test('falls back to the service key when no account is configured', () => {
    expect(mode({ ...on, SUPABASE_SERVICE_ROLE_KEY: 'eyJ...' })).toBe('service');
  });

  test('an email without a password is not enough', () => {
    expect(mode({ ...on, DEV_AUTH_EMAIL: 'a@b.com',
                  SUPABASE_SERVICE_ROLE_KEY: 'eyJ...' })).toBe('service');
  });

  test('nothing configured means nothing, not a silent default', () => {
    expect(mode(on)).toBe('none');
  });

  test('no mode at all when the bypass is off', () => {
    expect(mode({ NODE_ENV: 'production', DEV_AUTH_BYPASS: 'true',
                  DEV_AUTH_EMAIL: 'a@b.com', DEV_AUTH_PASSWORD: 'x' })).toBe('none');
  });
});
