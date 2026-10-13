/** Stable UI draft identity. Item entries follow the goods ID, never a row index. */
export function declarationDraftKey(caseId: string, fieldId: string, goodsLineId?: string): string {
  return JSON.stringify([caseId, fieldId, goodsLineId || null]);
}

export function hasDeclarationDrafts(drafts: Record<string, unknown>, caseId: string): boolean {
  return Object.keys(drafts).some(key => {
    try { return JSON.parse(key)[0] === caseId; } catch { return false; }
  });
}

/** A successful response cannot discard input changed while the request was in flight. */
export function clearSavedDeclarationDraft<T>(drafts: Record<string, T>, key: string, submitted: T): Record<string, T> {
  if (drafts[key] !== submitted) return drafts;
  const next = { ...drafts }; delete next[key]; return next;
}
