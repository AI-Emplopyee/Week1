import type { GoodsLine } from './types.ts';

/** A late save may only clear the exact draft array it submitted, never edits typed while awaiting it. */
export function clearSavedGoodsDraft(drafts: Record<string, GoodsLine[]>, caseId: string, submitted: GoodsLine[]): Record<string, GoodsLine[]> {
  if (drafts[caseId] !== submitted) return drafts;
  const next = { ...drafts }; delete next[caseId]; return next;
}
