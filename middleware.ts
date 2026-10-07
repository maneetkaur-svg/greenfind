import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { DEV_AUTH_BYPASS } from '@/lib/devAuth';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** Refreshes the session on every request and keeps signed-out users
 *  away from everything except /login. */
export async function middleware(request: NextRequest) {
  // Development bypass. There is no session to check or refresh, so the only
  // thing to do is send /login and /setup to the application instead.
  if (DEV_AUTH_BYPASS) {
    const path = request.nextUrl.pathname;
    if (path === '/login' || path === '/setup') {
      const url = request.nextUrl.clone();
      url.pathname = '/vendors';
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: CookieToSet[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  const open = path === '/login' || path === '/setup';
  if (!user && !open) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (user && (path === '/login' || path === '/setup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/vendors';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
