# Development authentication bypass

Lets you run the application locally without signing in, so the vendor
workflow can be tested before Supabase accounts are sorted out.

**It cannot be switched on in production or on Vercel.** That is enforced in
code, not by remembering to turn it off.

---

## Turning it on

Add one line to `.env.local`:

```
DEV_AUTH_BYPASS=true
```

Your `.env.local` should then have four lines:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DEV_AUTH_BYPASS=true
```

Then restart the dev server. Next.js only reads that file at startup.

```powershell
npm.cmd run dev
```

Open `http://localhost:3000`. You go straight to the vendor list, with a yellow
banner across the top saying the bypass is on.

## Turning it off

Delete the line, or set it to anything other than `true`. Restart the server.
The login page returns. Nothing was removed.

---

## Why the service key is needed

This is the part worth understanding, because it is not obvious.

Every row-level security policy asks `auth.uid()` — who is making this request.
With the login bypassed there is no session, so `auth.uid()` is null, `my_role()`
returns null, and **every policy denies**. You would get a working interface
showing zero vendors, and every save would fail.

So when the bypass is on, the server uses the **service role key**, which
outranks RLS.

What that does and does not mean:

- RLS is **not disabled**. Every policy is still there and still applies to the
  deployed application.
- The key is used **only on the server**, in `lib/supabase/server.ts`. It is
  never sent to a browser.
- It is already in your `.env.local` for `/setup` and `/users`, so nothing new
  is being exposed.
- Because the service key outranks the policies, **role restrictions are not
  being exercised while the bypass is on**. The session behaves as a Super
  Admin. Test role behaviour with real accounts.

---

## What was changed

| File | Change |
|---|---|
| `lib/devAuth.ts` | **New.** The one place that decides whether the bypass is active, and the fake profile it runs as |
| `lib/supabase/server.ts` | `createClient()` returns a service-key client when bypassed. `getMe()` returns the dev profile instead of reading a session |
| `middleware.ts` | Skips the session check when bypassed, and sends `/login` and `/setup` to `/vendors` |
| `app/(app)/layout.tsx` | Shows the banner; hides Sign out, which is meaningless with no session |
| `app/(app)/DevBanner.tsx` | **New.** The banner. Renders nothing when the bypass is off |
| `tests/devAuth.spec.ts` | **New.** Asserts the bypass cannot activate in production or on Vercel |

Nothing else was touched. No schema change, no RLS change, no change to any
form, save path or page.

## How the guard works

```ts
export const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' &&   // `next build` sets this
  !process.env.VERCEL &&                     // set on every Vercel deployment
  process.env.DEV_AUTH_BYPASS === 'true';    // deliberate opt-in
```

The first two conditions are not configurable. Setting `DEV_AUTH_BYPASS=true`
in Vercel's environment variables does nothing, because `VERCEL` is always set
there and `NODE_ENV` is `production` in a build.

`'TRUE'`, `'1'` and `'yes'` do not count. Only the exact string `'true'`.

## Restoring normal authentication

Remove the line from `.env.local`. That is all.

The login page, `/setup`, `/users`, the roles and the middleware are all intact
and unmodified. When Supabase accounts are working, delete the line and
everything behaves as before.

If you want the bypass gone from the codebase entirely later: delete
`lib/devAuth.ts`, `app/(app)/DevBanner.tsx` and `tests/devAuth.spec.ts`, then
remove the `DEV_AUTH_BYPASS` branches from `middleware.ts`,
`lib/supabase/server.ts` and `app/(app)/layout.tsx`. Each is a single guarded
block with a comment.

---

## Commands

```powershell
cd C:\Users\HP\Downloads\greenfind

npm.cmd install

# add DEV_AUTH_BYPASS=true to .env.local, then

npm.cmd run dev
```

If PowerShell refuses to run scripts, `npm.cmd` sidesteps it — which is why the
commands above use it rather than `npm`. Alternatively use Command Prompt,
where plain `npm` works.

To check it builds before pushing:

```powershell
npm.cmd run build
```
