import { revalidateEmailShipmentMatches } from './email-shipment-ai.ts';
import type { Action, Actor, EmailRecord, EmailShipmentMatch, WorkspaceState } from './types.ts';

export function currentEmailCaseId(state: WorkspaceState, id: string): string | undefined {
  const visited = new Set<string>();
  while (!visited.has(id)) {
    visited.add(id);
    const shipment = state.cases.find(item => item.id === id);
    if (!shipment) return;
    if (!shipment.mergedInto) return shipment.id;
    id = shipment.mergedInto;
  }
}

/** Recheck both cited proof and current competing shipment evidence before using a saved link. */
export function isEmailMatchCurrent(state: WorkspaceState, match: EmailShipmentMatch): boolean {
  const caseId = currentEmailCaseId(state, match.caseId);
  const email = state.emails.find(email => email.shipmentMatches?.some(saved => saved.id === match.id));
  if (!caseId || !email || !match.evidence.length) return false;
  const sourceStillExists = match.evidence.every(evidence => {
    const doc = state.documents.find(document => document.id === evidence.documentId && document.active && document.version === evidence.documentVersion && !document.referenceOnly);
    if (!doc || doc.caseId !== caseId || !doc.pages.some(page => page.page === evidence.page)) return false;
    return doc.pages.some(page => page.page === evidence.page && page.text.includes(evidence.documentQuote)) || state.candidates.some(candidate => candidate.documentId === doc.id && candidate.documentVersion === doc.version && candidate.page === evidence.page && !!candidate.visualEvidence && candidate.originalText.includes(evidence.documentQuote));
  });
  if (!sourceStillExists) return false;
  // Completed cases are excluded from new AI matching, but their saved
  // correspondence remains readable in the archive while its proof is intact.
  if (state.cases.find(shipment => shipment.id === caseId)?.status === 'completed') {
    const source = `${email.subject}\n${email.text ?? ''}`;
    return match.status === 'matched' && match.evidence.every(evidence => source.includes(evidence.emailQuote));
  }
  try {
    const result = revalidateEmailShipmentMatches(state, [{ emailId: email.id, caseId,
      decision: 'link', evidence: match.evidence, explanation: match.reason }]);
    const grounded = result.matches[0];
    if (result.rejected || result.matches.length !== 1 || !grounded) return false;
    // A human can resolve an ambiguous shared reference. An unattended AI link
    // must still meet the current uniqueness and reliability requirements.
    return match.decisionSource !== 'ai' || match.status !== 'matched' || grounded.decision === 'link';
  } catch {
    return false;
  }
}

export function emailLinkedToCase(state: WorkspaceState, email: EmailRecord, caseId: string): boolean {
  const target = currentEmailCaseId(state, caseId);
  if (!target) return false;
  // An original attachment is already an explicit relationship. AI associations add
  // body-only replies without moving every attachment in a multi-shipment message.
  if (state.documents.some(document => document.active && document.caseId === target && (email.documentIds.includes(document.id) || document.sourceEmailId === email.id))) return true;
  return !!email.shipmentMatches?.some(match => match.status === 'matched' && currentEmailCaseId(state, match.caseId) === target && isEmailMatchCurrent(state, match));
}

type EmailGroupingAction = Extract<Action, { type: 'apply_email_matches' | 'review_email_match' | 'email_matching_status' }>;
export function applyEmailGroupingAction(state: WorkspaceState, action: EmailGroupingAction, actor: Actor): void {
  const at = new Date().toISOString();
  if (action.type === 'email_matching_status') {
    for (const email of state.emails.filter(email => action.emailIds.includes(email.id))) {
      email.aiGroupingStatus = action.status; email.aiGroupedAt = at; email.aiGroupingError = action.reason;
    }
    return;
  }
  if (action.type === 'review_email_match') {
    const email = state.emails.find(email => email.id === action.emailId);
    const match = email?.shipmentMatches?.find(match => match.id === action.matchId);
    if (!email || !match) throw new Error('This email matching suggestion is no longer available.');
    if (!action.reason.trim()) throw new Error('Give a reason for the email matching decision.');
    if (action.decision === 'accept' && !isEmailMatchCurrent(state, match)) throw new Error('The supporting document changed. Match the email again before confirming it.');
    const before = structuredClone(match);
    match.status = action.decision === 'accept' ? 'matched' : 'rejected';
    match.decisionSource = 'human'; match.reviewedBy = actor.name; match.updatedAt = at; match.reason = action.reason.trim();
    state.audit.push({ id: `audit-${crypto.randomUUID()}`, caseId: currentEmailCaseId(state, match.caseId), at, actor: actor.name, action: 'email_match_reviewed', reason: match.reason, before, after: structuredClone(match) });
    return;
  }
  if (action.matches.some(match => !action.emailIds.includes(match.emailId))) throw new Error('Matching results refer to an unselected email.');
  const grounded = revalidateEmailShipmentMatches(state, action.matches);
  if (grounded.rejected) throw new Error('Email matching evidence changed. Refresh before trying again.');
  for (const emailId of [...new Set(action.emailIds)]) {
    const email = state.emails.find(email => email.id === emailId);
    if (!email) throw new Error('The selected email no longer exists.');
    const before = structuredClone(email.shipmentMatches ?? []);
    const matches = email.shipmentMatches ??= [];
    const proposals = grounded.matches.filter(match => match.emailId === emailId);
    const confirmedCaseIds = new Set(proposals.map(proposal => proposal.caseId));
    for (const prior of matches) {
      if (prior.decisionSource === 'human' || prior.status !== 'matched' || confirmedCaseIds.has(currentEmailCaseId(state, prior.caseId) ?? '')) continue;
      // Retain the previous proof and audit history when the latest run omits
      // an association. An omission is not renewed permission to keep using it.
      prior.status = 'needs_review';
      prior.reason = 'The latest matching run did not confirm this association. Review it before using it.';
      prior.updatedAt = at;
    }
    for (const proposal of proposals) {
      const prior = matches.find(match => currentEmailCaseId(state, match.caseId) === proposal.caseId);
      // A new model response can never undo a person's rejection or confirmation.
      if (prior?.decisionSource === 'human' && (prior.status === 'rejected' || isEmailMatchCurrent(state, prior))) continue;
      const needsReconfirmation = prior?.decisionSource === 'human';
      const next: EmailShipmentMatch = {
        id: prior?.id ?? `emailmatch-${crypto.randomUUID()}`, caseId: proposal.caseId,
        status: !needsReconfirmation && !action.truncated && proposal.decision === 'link' ? 'matched' : 'needs_review',
        evidence: structuredClone(proposal.evidence), reason: proposal.explanation, model: action.model,
        createdAt: prior?.createdAt ?? at, updatedAt: at, decisionSource: 'ai',
      };
      if (prior) matches[matches.indexOf(prior)] = next; else matches.push(next);
    }
    email.aiGroupingStatus = action.truncated ? 'partial' : 'complete';
    email.aiGroupedAt = at;
    if (action.truncated) email.aiGroupingError = 'Only part of the email matching context was checked. Review suggested links.';
    else delete email.aiGroupingError;
    state.audit.push({ id: `audit-${crypto.randomUUID()}`, at, actor: actor.name, action: 'email_shipments_matched', reason: 'Compared email references with current shipment evidence; attachments and declaration approvals were preserved.', before, after: { emailId, matches: structuredClone(matches), model: action.model, truncated: action.truncated } });
  }
}
