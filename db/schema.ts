import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().unique(),
  revision: integer('revision').notNull().default(0),
  stateJson: text('state_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

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
