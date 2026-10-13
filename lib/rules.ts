import type { ShipmentCase } from './types.ts';

/** Executable-rule interface only. Reviewed VNACCS reference sources are not an activated legal rule set or verified current code tables. */
export type CustomsRule = {
  id: string;
  version: string;
  source: { title: string; url: string; documentId?: string; section: string; verifiedBy: string };
  effectiveFrom: string;
  effectiveUntil?: string;
  scope: { jurisdiction: string; caseTypes: string[]; description: string };
  severity: 'error' | 'warning' | 'information';
  explanation: string;
  affectedFields: string[];
  evaluate: (declaration: Readonly<ShipmentCase>) => { applies: boolean; findings: string[] };
};
export type CodeTable = { id: string; version: string; source: CustomsRule['source']; effectiveFrom: string; effectiveUntil?: string; entries: { code: string; label: string }[] };
export const CUSTOMS_RULES: readonly CustomsRule[] = Object.freeze([]);
export const CODE_TABLES: readonly CodeTable[] = Object.freeze([]);
export function assessCustomsRules() {
  return { status: 'Not yet assessed' as const, ruleSetVersion: null, rulesEvaluated: 0, explanation: 'VNACCS reference sources have been reviewed, but executable legal rules and current code tables remain unverified and inactive. Customs decisions require qualified manual review.' };
}
/** A future rule refresh must invalidate the named decisions before re-review. */
export function decisionsAffectedByRuleChange(previous: readonly CustomsRule[], next: readonly CustomsRule[]): string[] {
  const all = new Map([...previous, ...next].map(rule => [rule.id, rule]));
  return [...new Set([...all.values()].filter(rule => previous.find(x => x.id === rule.id)?.version !== next.find(x => x.id === rule.id)?.version).flatMap(rule => [...(previous.find(x => x.id === rule.id)?.affectedFields ?? []), ...(next.find(x => x.id === rule.id)?.affectedFields ?? [])]))];
}
