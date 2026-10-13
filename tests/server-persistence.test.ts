import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { createEmptyWorkspace } from '../lib/engine.ts';
import {
  commitSucceeded,
  INLINE_WORKSPACE_BYTES,
  MAX_STORED_WORKSPACE_BYTES,
  prepareCommit,
  prepareWorkspaceCommit,
  readWorkspaceState,
  WORKSPACE_CHUNK_BYTES,
} from '../lib/server-persistence.ts';
import type { Actor, WorkspaceState } from '../lib/types.ts';

const actor: Actor = { id: 'alice', email: 'alice@example.invalid', name: 'Synthetic owner' };

/** Exercise the exact production SQL and transaction order against SQLite. */
class Statement {
  sql: string;
  values: SQLInputValue[];
  database: DatabaseSync;
  constructor(database: DatabaseSync, sql: string, values: SQLInputValue[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: SQLInputValue[]) { return new Statement(this.database, this.sql, values); }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    return { meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } };
  }
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_charming_ghost_rider.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0002_workspace_state_chunks.sql', import.meta.url), 'utf8'));
  const initial = createEmptyWorkspace('ws_test');
  sqlite.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?, ?)')
    .run(initial.id, actor.id, 0, JSON.stringify(initial), 'now', 'now');
  sqlite.prepare('INSERT INTO workspace_members VALUES (?, ?, ?, ?, ?, ?)')
    .run(initial.id, actor.email, actor.id, 'owner', actor.id, 'now');
  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sqlite, initial };
}

function largeState(revision = 1, marker = 'large'): WorkspaceState {
  const state = createEmptyWorkspace('ws_test');
  state.revision = revision;
  state.audit.push({
    id: marker,
    at: '2026-10-12T00:00:00.000Z',
    actor: actor.name,
    action: 'synthetic_large_snapshot',
    reason: 'Synthetic multibyte persistence boundary fixture.',
    after: 'Hàng hóa 📦 / 東京 / '.repeat(100_000),
  });
  assert.ok(Buffer.byteLength(JSON.stringify(state)) > INLINE_WORKSPACE_BYTES);
  return state;
}

test('legacy inline state remains readable and all reads require current membership', async () => {
  const { db, sqlite, initial } = fixture();
  try {
    assert.deepEqual(await readWorkspaceState(db, initial.id, actor.id), initial);
    assert.equal(await readWorkspaceState(db, initial.id, 'outsider'), null);
    assert.equal(await readWorkspaceState(db, 'ws_other', actor.id), null);
    const next = { ...initial, revision: 1 };
    assert.equal(commitSucceeded(await prepareCommit(db, next, 0, actor).run()), true);
    assert.deepEqual(await readWorkspaceState(db, initial.id, actor.id), next);
    assert.throws(() => prepareWorkspaceCommit(db, next, 1, actor), /exactly one revision/);
  } finally { sqlite.close(); }
});

test('large state round-trips exact Unicode in bounded chunks and preserves its complete audit', async () => {
  const { db, sqlite } = fixture();
  try {
    const next = largeState();
    assert.throws(() => prepareCommit(db, next, 0, actor), /atomic prepareWorkspaceCommit/);
    const results = await db.batch(prepareWorkspaceCommit(db, next, 0, actor));
    assert.equal(commitSucceeded(results[0]), true);
    const stored = sqlite.prepare('SELECT state_json FROM workspaces').get()!;
    assert.ok(Buffer.byteLength(String(stored.state_json)) < 1000);
    assert.equal(JSON.parse(String(stored.state_json)).audit[0].id, 'large');
    const chunks = sqlite.prepare('SELECT content FROM workspace_state_chunks ORDER BY chunk_index').all();
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => Buffer.byteLength(String(chunk.content)) <= WORKSPACE_CHUNK_BYTES));
    assert.deepEqual(await readWorkspaceState(db, next.id, actor.id), next);
  } finally { sqlite.close(); }
});

test('stale and foreign writers cannot insert chunks, remove the winning snapshot, or change audit', async () => {
  const { db, sqlite } = fixture();
  try {
    const winner = largeState(1, 'winner');
    const loser = largeState(1, 'loser');
    const winningBatch = prepareWorkspaceCommit(db, winner, 0, actor);
    const staleBatch = prepareWorkspaceCommit(db, loser, 0, actor);
    await db.batch(winningBatch);
    const before = sqlite.prepare('SELECT snapshot_id, chunk_index, content FROM workspace_state_chunks').all();
    const staleResults = await db.batch(staleBatch);
    assert.ok(staleResults.every((result) => result.meta.changes === 0));
    const forbiddenResults = await db.batch(prepareWorkspaceCommit(db, largeState(2, 'foreign'), 1, { ...actor, id: 'outsider' }));
    assert.ok(forbiddenResults.every((result) => result.meta.changes === 0));
    assert.deepEqual(sqlite.prepare('SELECT snapshot_id, chunk_index, content FROM workspace_state_chunks').all(), before);
    assert.deepEqual(await readWorkspaceState(db, winner.id, actor.id), winner);
    assert.equal(await readWorkspaceState(db, winner.id, 'outsider'), null);
  } finally { sqlite.close(); }
});

test('failed chunk or subsequent transactional work rolls back revision, data, and snapshot cleanup', async () => {
  const { db, sqlite } = fixture();
  try {
    const first = largeState();
    await db.batch(prepareWorkspaceCommit(db, first, 0, actor));
    const old = sqlite.prepare('SELECT snapshot_id, chunk_index, content FROM workspace_state_chunks').all();
    const next = largeState(2, 'next');
    const statements = prepareWorkspaceCommit(db, next, 1, actor);
    // Repeating an INSERT violates the composite primary key after CAS succeeds.
    await assert.rejects(db.batch([...statements.slice(0, 2), statements[1], ...statements.slice(2)]), /UNIQUE/);
    assert.deepEqual(await readWorkspaceState(db, first.id, actor.id), first);
    assert.deepEqual(sqlite.prepare('SELECT snapshot_id, chunk_index, content FROM workspace_state_chunks').all(), old);
    await assert.rejects(db.batch([...prepareWorkspaceCommit(db, next, 1, actor), db.prepare('INSERT INTO missing_table VALUES (1)')]), /no such table/);
    assert.deepEqual(await readWorkspaceState(db, first.id, actor.id), first);
    await db.batch(prepareWorkspaceCommit(db, next, 1, actor));
    assert.equal(sqlite.prepare('SELECT COUNT(DISTINCT snapshot_id) AS count FROM workspace_state_chunks').get()!.count, 1);
    const small = { ...createEmptyWorkspace(first.id), revision: 3 };
    await db.batch(prepareWorkspaceCommit(db, small, 2, actor));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_state_chunks').get()!.count, 0);
    assert.deepEqual(await readWorkspaceState(db, first.id, actor.id), small);
  } finally { sqlite.close(); }
});

test('team access remains tied to the exact successful audit commit for chunked states', async () => {
  const { db, sqlite } = fixture();
  try {
    const state = largeState(1, 'invite-audit');
    const grant = (email: string, auditId: string) => db.prepare(`INSERT INTO workspace_members
      (workspace_id, email, user_id, role, invited_by, created_at)
      SELECT id, ?, NULL, 'reviewer', ?, 'now' FROM workspaces
      WHERE id = ? AND revision = ? AND json_extract(state_json, '$.audit[#-1].id') = ?`)
      .bind(email, actor.id, state.id, state.revision, auditId);
    const result = await db.batch([...prepareWorkspaceCommit(db, state, 0, actor), grant('reviewer@example.invalid', 'invite-audit')]);
    assert.equal(result.at(-1)!.meta.changes, 1);
    const stale = largeState(1, 'stale-invite');
    const rejected = await db.batch([...prepareWorkspaceCommit(db, stale, 0, actor), grant('wrong@example.invalid', 'stale-invite')]);
    assert.ok(rejected.every((item) => item.meta.changes === 0));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_members').get()!.count, 2);
    assert.deepEqual(await readWorkspaceState(db, state.id, actor.id), state);
  } finally { sqlite.close(); }
});

test('corrupt or incomplete chunk sets fail closed instead of returning a partial workspace', async () => {
  const { db, sqlite } = fixture();
  try {
    const state = largeState();
    await db.batch(prepareWorkspaceCommit(db, state, 0, actor));
    const chunk = sqlite.prepare('SELECT * FROM workspace_state_chunks WHERE chunk_index = 0').get()!;
    sqlite.prepare('DELETE FROM workspace_state_chunks WHERE chunk_index = 0').run();
    await assert.rejects(readWorkspaceState(db, state.id, actor.id), /incomplete/);
    sqlite.prepare('INSERT INTO workspace_state_chunks VALUES (?, ?, ?, ?)').run(chunk.workspace_id as string, chunk.snapshot_id as string, 0, String(chunk.content).slice(1));
    await assert.rejects(readWorkspaceState(db, state.id, actor.id), /size check/);
  } finally { sqlite.close(); }
});

test('the 32 MiB materialized workspace limit is checked before any SQL mutation', () => {
  const { db, sqlite } = fixture();
  try {
    const state = largeState();
    state.audit[0].after = 'x'.repeat(MAX_STORED_WORKSPACE_BYTES);
    assert.throws(() => prepareWorkspaceCommit(db, state, 0, actor), /storage limit/);
    assert.equal(sqlite.prepare('SELECT revision FROM workspaces').get()!.revision, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM workspace_state_chunks').get()!.count, 0);
  } finally { sqlite.close(); }
});
