import type { Actor } from './types.ts';

/** Local mode has one actor; a display name typed in shared mode cannot create a second local assignee. */
export function reviewerForMode(localMode: boolean, actor: Actor, entered: string): string {
  return localMode ? actor.name : entered;
}
