import { ApiError, assertWorkspaceSize, json, readJson, requireSameOrigin, response, route, workspace, type WorkspaceContext } from '@/lib/server';
import { commitSucceeded, prepareCommit } from '@/lib/server-persistence';
import { inviteSchema } from '@/lib/server-validation';
export const dynamic = 'force-dynamic';
async function team(context: WorkspaceContext) {
  const { results } = await context.db.prepare('SELECT email, role, user_id, created_at FROM workspace_members WHERE workspace_id = ? ORDER BY created_at')
    .bind(context.state.id).all<{ email: string; role: 'owner' | 'reviewer'; user_id: string | null; created_at: string }>();
  return { members: results.map(member => ({ email: member.email, role: member.role, status: member.user_id ? 'active' : 'invited', createdAt: member.created_at })), canManage: context.role === 'owner' };
}
export function GET(request: Request) { return route(async () => json(await team(await workspace(request)))); }
export function POST(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const context = await workspace(request);
    if (context.role !== 'owner') throw new ApiError(403, 'Only the workspace owner can grant team access.');
    const { email: providedEmail } = inviteSchema.parse(await readJson(request));
    const email = providedEmail.toLowerCase();
    const existing = await context.db.prepare('SELECT email FROM workspace_members WHERE workspace_id = ? AND email = ?').bind(context.state.id, email).first();
    if (existing) return json({ ...await team(context), ...response(context), notice: 'This email already has workspace access.' });
    const count = await context.db.prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?').bind(context.state.id).first<{ count: number }>();
    if ((count?.count ?? 0) >= 25) throw new ApiError(422, 'The pilot supports up to 25 workspace members.');
    const at = new Date().toISOString();
    const auditId = `audit_${crypto.randomUUID()}`;
    const next = structuredClone(context.state);
    next.revision += 1;
    next.audit.push({ id: auditId, at, actor: context.actor.name, action: 'team_reviewer_allowed', after: email, reason: 'Owner granted reviewer access. No invitation email was sent.' });
    assertWorkspaceSize(next);
    // Both the access grant and its audit entry commit in the same D1 transaction.
    // The audit-id predicate makes the INSERT conditional on this exact successful revision update.
    const results = await context.db.batch([
      prepareCommit(context.db, next, context.state.revision, context.actor),
      context.db.prepare("INSERT INTO workspace_members (workspace_id, email, user_id, role, invited_by, created_at) SELECT id, ?, NULL, 'reviewer', ?, ? FROM workspaces WHERE id = ? AND revision = ? AND json_extract(state_json, '$.audit[#-1].id') = ?")
        .bind(email, context.actor.id, at, next.id, next.revision, auditId),
    ]);
    if (!commitSucceeded(results[0])) throw new ApiError(409, 'The workspace changed while granting access. Refresh and try again.');
    context.state = next;
    return json({ ...await team(context), ...response(context), notice: 'Reviewer allowlisted. Share the site link separately; no email was sent. Site access is also required.' });
  });
}
