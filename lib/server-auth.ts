import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ACCESS_COOKIE, AuthError, authCookie, authMode, supabaseConfig, userForToken } from './auth-provider.ts';
import { allowedIdentity, consumeRateLimit, hashAuthKey } from './auth-persistence.ts';
import type { Actor } from './types.ts';

export function authDatabase(): D1Database {
  if (!env.DB) throw new AuthError(503, 'Authentication storage is not available.');
  return env.DB;
}
export async function requireAuthActor(request: Request): Promise<Actor> {
  if (authMode(env) === 'sites') {
    const user = await getChatGPTUser();
    if (!user) throw new AuthError(401, 'Sign in with ChatGPT to access this workspace.');
    return { id: user.userId, email: user.email.toLowerCase(), name: user.displayName };
  }
  // Standalone mode never reads OAI proxy headers or trusts client-supplied IDs.
  const config = supabaseConfig(env);
  const access = authCookie(request, ACCESS_COOKIE);
  if (!access) throw new AuthError(401, 'Sign in to access this workspace.');
  const actor = await userForToken(config, access);
  if (!await allowedIdentity(authDatabase(), actor, config.ownerEmail)) throw new AuthError(403, 'Workspace membership is required. Contact the workspace owner.');
  return actor;
}
export async function limitAuthAttempt(request: Request, purpose: string, email?: string): Promise<void> {
  const db = authDatabase();
  // Cloudflare sets CF-Connecting-IP on deployed requests. Never use spoofable
  // X-Forwarded-For. The shared fallback is deliberately conservative in dev.
  const ip = request.headers.get('cf-connecting-ip')?.slice(0, 64) || 'unknown';
  const ipKey = `${purpose}:ip:${await hashAuthKey(ip)}`;
  const isReset = purpose === 'reset';
  const duration = isReset ? 3600 : purpose === 'refresh' ? 60 : 900;
  const ipLimit = isReset ? 10 : purpose === 'refresh' ? 60 : 30;
  if (!await consumeRateLimit(db, ipKey, ipLimit, duration)) throw new AuthError(429, 'Too many attempts. Please wait and try again.');
  if (email && !await consumeRateLimit(db, `${purpose}:email:${await hashAuthKey(email)}`, isReset ? 3 : 10, duration)) throw new AuthError(429, 'Too many attempts. Please wait and try again.');
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.prepare('DELETE FROM auth_rate_limits WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM auth_recovery_grants WHERE expires_at <= ?').bind(now),
  ]);
}
