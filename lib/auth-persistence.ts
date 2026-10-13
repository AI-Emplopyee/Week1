import type { Actor } from './types.ts';

// Condition and increment are one atomic D1/SQLite statement. Denied attempts
// cannot grow a counter without bound or reset a still-active window.
export const RATE_LIMIT_SQL = `INSERT INTO auth_rate_limits (key, count, expires_at) VALUES (?, 1, ?)
ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
WHERE expires_at <= ? OR count < ? RETURNING count`;
export async function consumeRateLimit(db: D1Database, key: string, limit: number, windowSeconds: number, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1 || key.length > 256) throw new Error('Invalid rate limit configuration.');
  const result = await db.prepare(RATE_LIMIT_SQL).bind(key, now + windowSeconds, now, now, now, limit).first();
  return !!result;
}
export async function hashAuthKey(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
export type IdentityMember = { user_id: string | null; email: string };
export function canUseMembership(actor: Actor, members: IdentityMember[]): boolean {
  return members.some(member => member.email === actor.email && (member.user_id === null || member.user_id === actor.id));
}
export async function allowedIdentity(db: D1Database, actor: Actor, ownerEmail: string): Promise<boolean> {
  const { results } = await db.prepare('SELECT user_id, email FROM workspace_members WHERE email = ?').bind(actor.email).all<IdentityMember>();
  if (canUseMembership(actor, results)) return true;
  // Never rebind an existing identity to a different provider by email.
  if (results.length || actor.email !== ownerEmail) return false;
  const existing = await db.prepare('SELECT id FROM workspaces LIMIT 1').first();
  return !existing;
}
export const CONSUME_RECOVERY_SQL = 'DELETE FROM auth_recovery_grants WHERE token_hash = ? AND user_id = ? AND expires_at > ? RETURNING user_id';
