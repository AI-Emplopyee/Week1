import type { Actor, WorkspaceState } from './types';

export const COMMIT_SQL = `UPDATE workspaces SET state_json = ?, revision = ?, updated_at = ?
  WHERE id = ? AND revision = ? AND EXISTS (
    SELECT 1 FROM workspace_members WHERE workspace_id = workspaces.id AND user_id = ?
  )`;
export function prepareCommit(db: D1Database, state: WorkspaceState, expectedRevision: number, actor: Actor): D1PreparedStatement {
  if (state.revision !== expectedRevision + 1) throw new Error('A workspace commit must advance exactly one revision.');
  return db.prepare(COMMIT_SQL).bind(JSON.stringify(state), state.revision, new Date().toISOString(), state.id, expectedRevision, actor.id);
}
export function commitSucceeded(result: { meta?: { changes?: number } }): boolean { return result.meta?.changes === 1; }
