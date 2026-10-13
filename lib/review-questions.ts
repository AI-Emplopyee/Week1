import type { Candidate, Issue, WorkspaceState } from "./types.ts";
import { isShipmentFactClear, normalizedShipmentValue } from "./shipment-autofill.ts";

export type ReviewQuestion = {
  kind: "confirm" | "choose" | "missing" | "review";
  candidates: Candidate[];
  values: string[];
};

/** A question may offer only evidence from a current document in this shipment. */
export function reviewQuestion(
  state: WorkspaceState,
  issue: Issue,
): ReviewQuestion {
  const active = new Map(
    state.documents
      .filter((document) => document.active && document.caseId === issue.caseId)
      .map((document) => [document.id, document.version]),
  );
  const candidates = state.candidates.filter(
    (candidate) =>
      issue.candidateIds.includes(candidate.id) &&
      candidate.caseId === issue.caseId &&
      active.get(candidate.documentId) === candidate.documentVersion &&
      candidate.value.trim(),
  );
  const distinctValues = new Map<string, string>();
  for (const candidate of candidates) {
    const key = `${candidate.field}:${normalizedShipmentValue(candidate.field, candidate.value)}`;
    if (!distinctValues.has(key))
      distinctValues.set(key, candidate.value.trim());
  }
  // Keep one original display value per semantic value, plus all original evidence.
  const values = [...distinctValues.values()];
  const kind =
    issue.kind === "missing" && issue.field && values.length === 0
      ? "missing"
      : issue.field &&
          values.length > 1 &&
          ["conflict", "uncertain", "stale"].includes(issue.kind)
        ? "choose"
        : issue.field &&
            values.length === 1 &&
            ["uncertain", "stale"].includes(issue.kind)
          ? "confirm"
          : "review";
  return { kind, candidates, values };
}

/** Routine sign-off remains in the declaration editor; questions address uncertainty. */
export function actionableReviewIssues(
  state: WorkspaceState,
  issues: Issue[],
): Issue[] {
  return issues.filter((issue) => {
    if (issue.resolved) return false;
    if (issue.kind === "declaration" && issue.id.endsWith(":review:review"))
      return false;
    if (issue.kind === "goods" && issue.id === `${issue.caseId}:goods-review`)
      return false;
    if (
      issue.kind === "uncertain" &&
      issue.field &&
      issue.id === `${issue.caseId}:review-${issue.field}`
    ) {
      const { candidates } = reviewQuestion(state, issue);
      if (
        isShipmentFactClear(state, issue.field, candidates)
      )
        return false;
    }
    return true;
  });
}

/** Keep a surviving question open after another question is completed. */
export function expandedReviewIssueId(
  issues: readonly Issue[],
  selectedId: string,
): string {
  if (selectedId === "__closed__") return "";
  return issues.some((issue) => issue.id === selectedId)
    ? selectedId
    : issues[0]?.id || "";
}
