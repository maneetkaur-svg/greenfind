# GreenFind — Vendor Master

Internal vendor master for Fitsol. Next.js 15 + Supabase.

## Before this will run

The Supabase database must exist first. Run these three files in the Supabase
SQL editor, in order:

1. `01_schema.sql`
2. `02_security.sql`
3. `03_reference_data.sql`

Then create your own user (Authentication → Add user) and give it a profile row.

## Environment variables

Two, both safe in the browser because row-level security is switched on.

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

On Vercel these go in Settings → Environment Variables.
Locally they go in a file called `.env.local`, which is never committed.

Never add `SUPABASE_SERVICE_ROLE_KEY` with a `NEXT_PUBLIC_` prefix. That key
bypasses every permission rule.

## Running locally

```
npm install
npm run dev
```

## What is built

Sign in and out, the vendor list, adding a vendor with automatic company
detection from the PAN inside the GSTIN, and the vendor record page.

Still to come: editing, document upload and verification, the change-request
approval queue, service categories and geography, the vendor evaluation,
import and export.
