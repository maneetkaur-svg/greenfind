'use server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getMe } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type UserState = { error?: string; ok?: string };

export async function addUser(_prev: UserState, formData: FormData): Promise<UserState> {
  const me = await getMe();
  if (!me || me.role !== 'super_admin')
    return { error: 'Only a Super Admin can add people.' };

  const name = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'user');

  if (!name) return { error: 'Enter their name.' };
  if (!email) return { error: 'Enter their email address.' };
  if (!['super_admin', 'operations', 'user'].includes(role))
    return { error: 'Pick a valid role.' };

  let admin;
  try { admin = createAdminClient(); }
  catch { return { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment.' }; }

  // No admin-chosen password — Supabase sends its own invite email with a
  // secure, one-time link, and the person sets their own password on
  // /set-password. Nothing resembling a credential ever travels by email.
  //
  // The link's domain must be the one the *recipient* can actually reach,
  // never whichever machine happened to send the invite — so this prefers
  // NEXT_PUBLIC_SITE_URL (set in Vercel to the real production domain) and
  // only falls back to the request's own host for local testing, where
  // there is no real deployed URL to fall back to.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');
  let origin = siteUrl;
  if (!origin) {
    const h = await headers();
    const host = h.get('host') ?? 'localhost:3000';
    origin = `${host.includes('localhost') ? 'http' : 'https'}://${host}`;
  }

  const { data: created, error: authErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name },
    redirectTo: `${origin}/set-password`,
  });
  if (authErr) return { error: 'Could not create the login: ' + authErr.message };

  const { error: profErr } = await admin.from('profile').insert({
    id: created.user.id, full_name: name, email, role, is_active: true,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: 'Login created but the profile row failed, so it was rolled back: ' + profErr.message };
  }

  revalidatePath('/users');
  return { ok: `An invite email is on its way to ${email}. They set their own password when they click it.` };
}

export async function setRole(formData: FormData) {
  const me = await getMe();
  if (!me || me.role !== 'super_admin') return;
  const id = String(formData.get('id') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!['super_admin', 'operations', 'user'].includes(role)) return;
  if (id === me.id) return;            // no changing your own role

  const admin = createAdminClient();
  await admin.from('profile').update({ role }).eq('id', id);
  revalidatePath('/users');
}

export async function setActive(formData: FormData) {
  const me = await getMe();
  if (!me || me.role !== 'super_admin') return;
  const id = String(formData.get('id') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (id === me.id) return;            // no locking yourself out

  const admin = createAdminClient();
  await admin.from('profile').update({ is_active: active }).eq('id', id);
  revalidatePath('/users');
}
