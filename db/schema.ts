import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().unique(),
  revision: integer('revision').notNull().default(0),
  stateJson: text('state_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaceStateChunks = sqliteTable('workspace_state_chunks', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  snapshotId: text('snapshot_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.snapshotId, table.chunkIndex] })]);

export const workspaceMembers = sqliteTable('workspace_members', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  email: text('email').notNull(),
  userId: text('user_id'),
  role: text('role', { enum: ['owner', 'reviewer'] }).notNull(),
  invitedBy: text('invited_by').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.workspaceId, table.email] }),
  uniqueIndex('workspace_member_identity').on(table.workspaceId, table.userId),
]);

export const authRateLimits = sqliteTable('auth_rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('auth_rate_limits_expiry').on(table.expiresAt)]);

export const authRecoveryGrants = sqliteTable('auth_recovery_grants', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('auth_recovery_grants_expiry').on(table.expiresAt)]);
