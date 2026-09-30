'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect('/login?error=' + encodeURIComponent(error.message));
  }

  // Authentication is not enough — a profile row is what grants permissions.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profile').select('id, is_active').eq('id', user!.id).single();

  if (!profile) {
    await supabase.auth.signOut();
    redirect('/login?error=' + encodeURIComponent(
      'Signed in, but there is no profile row for this account. A Super Admin has to add one before you can do anything.'));
  }
  if (!profile.is_active) {
    await supabase.auth.signOut();
    redirect('/login?error=' + encodeURIComponent('This account has been deactivated.'));
  }

  revalidatePath('/', 'layout');
  redirect('/vendors');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
