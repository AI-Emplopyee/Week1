import { env } from 'cloudflare:workers';
import { ZodError } from 'zod';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { applyAction, createEmptyWorkspace, getIssues } from '@/lib/engine';
import { commitSucceeded, prepareCommit } from '@/lib/server-persistence';
import { MAX_JSON_BYTES, MAX_WORKSPACE_BYTES, parseId, sameOrigin } from '@/lib/server-validation';
import type { Action, Actor, WorkspaceResponse, WorkspaceState } from '@/lib/types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: object) { super(message); }
}
type Membership = { workspace_id: string; role: 'owner' | 'reviewer' };
type WorkspaceRow = { id: string; revision: number; state_json: string };
export type WorkspaceContext = { db: D1Database; state: WorkspaceState; actor: Actor; role: 'owner' | 'reviewer' };
export const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
export function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: privateHeaders }); }
export async function route(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, ...error.detail }, error.status);
    if (error instanceof ZodError) return json({ error: error.issues.map(issue => `${issue.path.join('.') || 'Request'}: ${issue.message}`).join('; ') }, 400);
    if (error instanceof SyntaxError) return json({ error: 'The request contains invalid JSON.' }, 400);
    console.error('AICD request failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'The request could not be completed. Please retry. If this continues, contact your workspace owner.' }, 500);
  }
}
export function requireSameOrigin(request: Request): void {
  if (!sameOrigin(request)) throw new ApiError(403, 'This action must originate from the AICD application.');
}
export async function readLimitedBytes(request: Request, limit: number): Promise<Uint8Array> {
  const length = Number(request.headers.get('content-length'));
  if (length > limit) throw new ApiError(413, 'The request is too large.');
  if (!request.body) throw new ApiError(400, 'A request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new ApiError(413, 'The request is too large.'); }
    chunks.push(value);
  }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'Use application/json for this request.');
  return JSON.parse(new TextDecoder().decode(await readLimitedBytes(request, MAX_JSON_BYTES)));
}
export function bucket(): R2Bucket {
  if (!env.BUCKET) throw new ApiError(503, 'Original document storage is not available.');
  return env.BUCKET;
}
export async function workspace(request: Request): Promise<WorkspaceContext> {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, 'Sign in with ChatGPT to access this workspace.');
  if (!env.DB) throw new ApiError(503, 'Workspace storage is not available.');
  const db = env.DB;
  const actor: Actor = { id: user.userId, email: user.email.toLowerCase(), name: user.displayName };
  // Only a trusted, signed-in identity can claim a matching, owner-created invitation.
  await db.prepare('UPDATE workspace_members SET user_id = ? WHERE email = ? AND user_id IS NULL')
    .bind(actor.id, actor.email).run();
  const requested = new URL(request.url).searchParams.get('workspaceId');
  let membership: Membership | null;
  if (requested) {
    parseId(requested);
    membership = await db.prepare('SELECT workspace_id, role FROM workspace_members WHERE user_id = ? AND workspace_id = ?')
      .bind(actor.id, requested).first<Membership>();
    if (!membership) throw new ApiError(404, 'Workspace not found.');
  } else {
    membership = await db.prepare("SELECT workspace_id, role FROM workspace_members WHERE user_id = ? ORDER BY CASE WHEN role = 'reviewer' THEN 0 ELSE 1 END, created_at DESC LIMIT 1")
      .bind(actor.id).first<Membership>();
    if (!membership) {
      const state = createEmptyWorkspace(`ws_${crypto.randomUUID()}`);
      const at = new Date().toISOString();
      // Unique owner_id makes concurrent first visits converge to one personal workspace.
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO workspaces (id, owner_id, revision, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(state.id, actor.id, state.revision, JSON.stringify(state), at, at),
        db.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, email, user_id, role, invited_by, created_at) SELECT id, ?, ?, 'owner', ?, ? FROM workspaces WHERE owner_id = ?")
          .bind(actor.email, actor.id, actor.id, at, actor.id),
      ]);
      membership = await db.prepare('SELECT workspace_id, role FROM workspace_members WHERE user_id = ? LIMIT 1').bind(actor.id).first<Membership>();
    }
  }
  if (!membership) throw new ApiError(403, 'Workspace membership is required.');
  const row = await db.prepare('SELECT id, revision, state_json FROM workspaces WHERE id = ?').bind(membership.workspace_id).first<WorkspaceRow>();
  if (!row) throw new ApiError(404, 'Workspace not found.');
  const state = JSON.parse(row.state_json) as WorkspaceState;
  state.revision = row.revision;
  return { db, state, actor, role: membership.role };
}
export function response(context: WorkspaceContext): WorkspaceResponse {
  return { state: context.state, actor: context.actor, role: context.role, issues: getIssues(context.state) };
}
export function expectRevision(context: WorkspaceContext, expected: number): void {
  if (context.state.revision !== expected) throw new ApiError(409, 'The workspace changed in another session. Review the latest state before trying again.', response(context));
}
export function assertWorkspaceSize(state: WorkspaceState): void {
  if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_WORKSPACE_BYTES) throw new ApiError(413, 'This pilot workspace has reached its record storage limit. No changes were saved.');
}
export async function mutate(context: WorkspaceContext, expected: number, action: Action): Promise<WorkspaceResponse> {
  expectRevision(context, expected);
  if (action.type === 'settings' && context.role !== 'owner') throw new ApiError(403, 'Only the workspace owner can change settings.');
  let next: WorkspaceState;
  try { next = applyAction(context.state, action, context.actor); }
  catch (error) { throw new ApiError(422, error instanceof Error ? error.message : 'This action is not valid for the current case.'); }
  next.revision = expected + 1;
  assertWorkspaceSize(next);
  const result = await prepareCommit(context.db, next, expected, context.actor).run();
  if (!commitSucceeded(result)) {
    const row = await context.db.prepare('SELECT state_json, revision FROM workspaces WHERE id = ? AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = workspaces.id AND user_id = ?)')
      .bind(context.state.id, context.actor.id).first<WorkspaceRow>();
    if (!row) throw new ApiError(403, 'Workspace membership is required.');
    context.state = JSON.parse(row.state_json) as WorkspaceState;
    context.state.revision = row.revision;
    throw new ApiError(409, 'The workspace changed in another session. Review the latest state before trying again.', response(context));
  }
  context.state = next;
  return response(context);
}
