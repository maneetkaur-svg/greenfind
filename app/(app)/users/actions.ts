'use server';
import { revalidatePath } from 'next/cache';
import { getMe } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type UserState = { error?: string; ok?: string };

export async function addUser(_prev: UserState, formData: FormData): Promise<UserState> {
  const me = await getMe();
  if (!me || me.role !== 'super_admin')
    return { error: 'Only a Super Admin can add people.' };

  const name = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const role = String(formData.get('role') ?? 'user');

  if (!name) return { error: 'Enter their name.' };
  if (!email) return { error: 'Enter their email address.' };
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.' };
  if (!['super_admin', 'operations', 'user'].includes(role))
    return { error: 'Pick a valid role.' };

  let admin;
  try { admin = createAdminClient(); }
  catch { return { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment.' }; }

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
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
  return { ok: `${name} can now sign in. Send them the email and password — there is no confirmation link to click.` };
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
