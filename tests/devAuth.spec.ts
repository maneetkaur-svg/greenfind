import { test, expect } from '@playwright/test';

/** The guard itself, checked without a browser. These assertions are the
 *  reason the bypass cannot reach production, so they matter more than the
 *  rest of the suite. */
test.describe('the production safeguard', () => {
  const guard = (env: Record<string, string | undefined>) =>
    env.NODE_ENV !== 'production' &&
    !env.VERCEL &&
    env.DEV_AUTH_BYPASS === 'true';

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
});
