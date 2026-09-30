'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type SetupState = { error?: string };

/** Creates the very first account and makes it Super Admin.
 *  Refuses once any profile exists, so this cannot be used to sneak
 *  a second admin in later. */
export async function createFirstAdmin(
  _prev: SetupState, formData: FormData
): Promise<SetupState> {
  const name = String(formData.get('full_name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!name) return { error: 'Enter your name.' };
  if (!email) return { error: 'Enter an email address.' };
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.' };
  if (password !== confirm) return { error: 'The two passwords do not match.' };

  let admin;
  try { admin = createAdminClient(); }
  catch {
    return { error: 'The service key is missing on this deployment. Add SUPABASE_SERVICE_ROLE_KEY in Vercel, with no NEXT_PUBLIC_ prefix, then redeploy.' };
  }

  const { count, error: countErr } = await admin
    .from('profile').select('id', { count: 'exact', head: true });
  if (countErr)
    return { error: 'Could not read the profile table: ' + countErr.message
      + '. If it says the relation does not exist, 01_schema.sql has not been run.' };
  if ((count ?? 0) > 0)
    return { error: 'An account already exists, so this page is closed. Ask a Super Admin to add you from the Users screen.' };

  // email_confirm skips the confirmation email entirely — no link to click,
  // which is why the localhost invitation problem does not arise here.
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (authErr) return { error: 'Could not create the login: ' + authErr.message };

  const { error: profErr } = await admin.from('profile').insert({
    id: created.user.id, full_name: name, email, role: 'super_admin', is_active: true,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: 'Login created but the profile row failed, so it has been rolled back: ' + profErr.message };
  }

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password });
  revalidatePath('/', 'layout');
  redirect('/vendors');
}
