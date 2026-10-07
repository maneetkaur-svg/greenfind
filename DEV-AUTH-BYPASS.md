# Development authentication bypass

Run the application locally without signing in, so the vendor workflow can be
tested before Supabase accounts are sorted out.

**It cannot switch on in production or on Vercel.** Enforced in code, not by
remembering.

---

## Why the login alone is not enough

Every row-level security policy asks `auth.uid()` — who is making this request.
Skipping the login means there is no session, `auth.uid()` is null, `my_role()`
returns null, and **every policy denies**. You get a working interface showing
zero vendors and failing every save.

So something has to tell the server who it is. There are two ways, and the first
is much better.

---

## Mode A — a real account. Preferred.

The server signs in as a genuine Supabase account using credentials from
`.env.local`.

```
DEV_AUTH_BYPASS=true
DEV_AUTH_EMAIL=you@fitsol.green
DEV_AUTH_PASSWORD=your-password
```

What this gives you:

- `auth.uid()` is a real user id
- **every RLS policy applies exactly as it does in production**
- writes are attributed to that account, not to nobody
- **role restrictions are genuinely exercised** — sign in as an `operations`
  account and you will correctly be unable to delete

This is the right mode for testing the workflow. Nothing about the database is
weakened; you have simply skipped typing the password into a form.

## Mode B — the service key. Bootstrap only.

For before any account exists.

```
DEV_AUTH_BYPASS=true
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

The service key outranks RLS, so queries work. But **role restrictions are not
exercised** — everything behaves as Super Admin whatever the real roles are.
The banner turns red to say so.

Use this to get in once, create an account at `/users`, then switch to Mode A.

### Which mode is chosen

Automatically: if `DEV_AUTH_EMAIL` and `DEV_AUTH_PASSWORD` are both set, Mode A.
Otherwise, if the service key is set, Mode B. Otherwise an error naming both
options. A real account always wins over the service key when both are present.

---

## Getting started

**If you have no Supabase account yet**, start with Mode B, create yourself one
at `/users`, then move to Mode A and delete the service key line.

**If you do**, use Mode A. The service key is not needed for the bypass at all
— though `/setup` and `/users` still need it to create logins.

```powershell
cd C:\Users\HP\Downloads\greenfind
npm.cmd install
# edit .env.local
npm.cmd run dev
```

**Restart after editing `.env.local`.** Next.js reads it once, at startup. This
catches everyone.

## Turning it off

Delete `DEV_AUTH_BYPASS` from `.env.local`, or set it to anything but `true`.
Restart. The login page returns. Nothing was removed.

---

## Files changed

| File | Change |
|---|---|
| `lib/devAuth.ts` | The guard, the mode selection and the status line |
| `lib/supabase/devSession.ts` | **New.** Signs in as a real account, caches the client |
| `lib/supabase/server.ts` | `createClient()` picks a mode; `getMe()` reads the real profile in Mode A |
| `middleware.ts` | Skips the session check when bypassed; `/login` and `/setup` go to `/vendors` |
| `app/(app)/layout.tsx` | Shows the banner, hides Sign out |
| `app/(app)/DevBanner.tsx` | Banner; amber in Mode A, red in Mode B |
| `tests/devAuth.spec.ts` | Asserts the guard and the mode selection |

No schema change. No RLS change. No change to any form, save path or page.

## The guard

```ts
export const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' &&   // `next build` sets this
  !process.env.VERCEL &&                     // set on every Vercel deployment
  process.env.DEV_AUTH_BYPASS === 'true';    // deliberate opt-in
```

The first two are not configurable. Setting the flag in Vercel does nothing.
`'TRUE'`, `'1'` and `'yes'` do not count — only the exact string `'true'`.

## Removing it entirely, later

Delete `lib/devAuth.ts`, `lib/supabase/devSession.ts`, `app/(app)/DevBanner.tsx`
and `tests/devAuth.spec.ts`, then remove the `DEV_AUTH_BYPASS` branches from
`middleware.ts`, `lib/supabase/server.ts` and `app/(app)/layout.tsx`. Each is a
single guarded block with a comment above it.

---

## Environment variables

| Name | Needed for | Reaches the browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Always | Yes, by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Always | Yes, safe because RLS is on |
| `DEV_AUTH_BYPASS` | The bypass | No |
| `DEV_AUTH_EMAIL` | Mode A | No |
| `DEV_AUTH_PASSWORD` | Mode A | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Mode B, and `/setup` and `/users` | **No. Never.** |
