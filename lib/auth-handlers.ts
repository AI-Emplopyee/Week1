import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ApiError, json, readLimitedBytes, requireSameOrigin, route } from './server.ts';
import { ACCESS_COOKIE, REFRESH_COOKIE, AuthError, authCookie, authMode, emptySchema, loginSchema, parseSession, passwordSchema, providerRequest, resetSchema, revokeCurrentSession, sessionCookies, supabaseConfig, userForToken, verifySchema, type AuthSession, type SupabaseConfig } from './auth-provider.ts';
import { allowedIdentity, CONSUME_RECOVERY_SQL, hashAuthKey } from './auth-persistence.ts';
import { authDatabase, limitAuthAttempt, requireAuthActor } from './server-auth.ts';
import type { Actor } from './types.ts';

const safeUser = (actor: Actor) => ({ email: actor.email, name: actor.name });
async function authBody(request: Request): Promise<unknown> {
  requireSameOrigin(request);
  // Secure cookies are required, including for local standalone authentication.
  if (new URL(request.url).protocol !== 'https:') throw new ApiError(400, 'Email sign-in requires HTTPS.');
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'Use application/json for this request.');
  return JSON.parse(new TextDecoder().decode(await readLimitedBytes(request, 8192)));
}
function withSession(response: Response, session?: AuthSession): Response {
  for (const value of sessionCookies(session)) response.headers.append('Set-Cookie', value);
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
async function verifiedSession(config: SupabaseConfig, value: unknown): Promise<{ session: AuthSession; actor: Actor }> {
  const session = parseSession(value);
  const actor = await userForToken(config, session.access_token);
  if (!await allowedIdentity(authDatabase(), actor, config.ownerEmail)) {
    await providerRequest(config, '/logout?scope=local', { method: 'POST', accessToken: session.access_token }).catch(() => {});
    throw new AuthError(401);
  }
  return { session, actor };
}
export function authStatus(request: Request): Promise<Response> {
  return route(async () => {
    let mode: 'sites' | 'supabase';
    try { mode = authMode(env); } catch { return json({ mode: 'unconfigured', configured: false, authenticated: false }); }
    if (mode === 'sites') {
      const user = await getChatGPTUser();
      return json({ mode, configured: true, authenticated: !!user, ...(user ? { user: { email: user.email, name: user.displayName } } : {}) });
    }
    try { supabaseConfig(env); authDatabase(); } catch { return json({ mode, configured: false, authenticated: false }); }
    try {
      const actor = await requireAuthActor(request);
      return json({ mode, configured: true, authenticated: true, user: safeUser(actor) });
    } catch (error) {
      if (!(error instanceof AuthError) || ![401, 403].includes(error.status)) throw error;
      return json({ mode, configured: true, authenticated: false, canRefresh: error.status === 401 && !!authCookie(request, REFRESH_COOKIE) });
    }
  });
}
export function authLogin(request: Request): Promise<Response> {
  return route(async () => {
    const config = supabaseConfig(env);
    const body = loginSchema.safeParse(await authBody(request));
    if (!body.success) throw new AuthError(400, 'Enter a valid email address and password.');
    await limitAuthAttempt(request, 'login', body.data.email);
    const { session, actor } = await verifiedSession(config, await providerRequest(config, '/token?grant_type=password', { method: 'POST', body: body.data }));
    return withSession(json({ ok: true, user: safeUser(actor) }), session);
  });
}
export function authRefresh(request: Request): Promise<Response> {
  return route(async () => {
    const config = supabaseConfig(env);
    emptySchema.parse(await authBody(request));
    await limitAuthAttempt(request, 'refresh');
    const refresh = authCookie(request, REFRESH_COOKIE);
    if (!refresh) return withSession(json({ error: 'Sign in to access this workspace.' }, 401));
    try {
      const { session, actor } = await verifiedSession(config, await providerRequest(config, '/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refresh } }));
      return withSession(json({ ok: true, user: safeUser(actor) }), session);
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) return withSession(json({ error: error.message }, 401));
      throw error;
    }
  });
}
export function authLogout(request: Request): Promise<Response> {
  return route(async () => {
    const config = supabaseConfig(env);
    emptySchema.parse(await authBody(request));
    const access = authCookie(request, ACCESS_COOKIE);
    const refresh = authCookie(request, REFRESH_COOKIE);
    let remoteRevoked = false;
    try {
      await limitAuthAttempt(request, 'logout');
      if (access) await authDatabase().prepare('DELETE FROM auth_recovery_grants WHERE token_hash = ?').bind(await hashAuthKey(access)).run();
      remoteRevoked = await revokeCurrentSession(config, access, refresh);
    } catch { /* Local sign-out remains possible during a provider/storage outage. */ }
    return withSession(json({ ok: true, remoteRevoked }));
  });
}
export function authVerify(request: Request): Promise<Response> {
  return route(async () => {
    const config = supabaseConfig(env);
    const body = verifySchema.safeParse(await authBody(request));
    if (!body.success) throw new AuthError(400, 'This account link is invalid. Request a new link.');
    await limitAuthAttempt(request, 'verify');
    const { session, actor } = await verifiedSession(config, await providerRequest(config, '/verify', { method: 'POST', body: body.data }));
    await authDatabase().prepare('INSERT INTO auth_recovery_grants (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await hashAuthKey(session.access_token), actor.id, Math.floor(Date.now() / 1000) + 600).run();
    return withSession(json({ ok: true, user: safeUser(actor) }), session);
  });
}
export function authPassword(request: Request): Promise<Response> {
  return route(async () => {
    const config = supabaseConfig(env);
    const body = passwordSchema.safeParse(await authBody(request));
    if (!body.success) throw new AuthError(400, 'Use a password of 12 to 128 characters.');
    await limitAuthAttempt(request, 'password');
    const actor = await requireAuthActor(request);
    const access = authCookie(request, ACCESS_COOKIE)!;
    const proof = await authDatabase().prepare(CONSUME_RECOVERY_SQL).bind(await hashAuthKey(access), actor.id, Math.floor(Date.now() / 1000)).first();
    if (!proof) throw new AuthError(403, 'Verify a new invitation or password recovery link before setting your password.');
    await providerRequest(config, '/user', { method: 'PUT', accessToken: access, body: body.data });
    return json({ ok: true, user: safeUser(actor) });
  });
}
export function authResetPassword(request: Request): Promise<Response> {
  return route(async () => {
    const config = supabaseConfig(env);
    const body = resetSchema.safeParse(await authBody(request));
    if (!body.success) throw new AuthError(400, 'Enter a valid email address.');
    await limitAuthAttempt(request, 'reset', body.data.email);
    // Provider recovery uses a generic response for existing and unknown users.
    // Sending it for both avoids exposing the private workspace allowlist.
    try { await providerRequest(config, '/recover', { method: 'POST', body: body.data }); }
    catch (error) { if (!(error instanceof AuthError) || error.status >= 500) throw error; }
    return json({ ok: true });
  });
}
