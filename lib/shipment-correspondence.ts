import { emailLinkedToCase } from './email-grouping.ts';
import type { Action, Actor, Issue, WorkspaceState } from './types.ts';
import { getDeclarationField } from './declaration-catalog.ts';
import { fieldLabel, translateIssue } from './i18n-core.ts';
import { reviewQuestion } from './review-questions.ts';

type CorrespondenceAction = Extract<Action, { type: 'draft_questions' | 'save_email_draft' }>;

/** Creates local correspondence only. There is deliberately no send operation here. */
export function applyCorrespondenceAction(state: WorkspaceState, action: CorrespondenceAction, actor: Actor, issues: Issue[]): void {
  const drafts = state.emailDrafts ??= [];
  const at = new Date().toISOString();
  if (action.type === 'save_email_draft') {
    const draft = drafts.find(item => item.id === action.draftId);
    if (!draft) throw new Error('Email draft not found.');
    const shipment = state.cases.find(item => item.id === draft.caseId && !item.mergedInto);
    if (!shipment || shipment.status === 'completed') throw new Error('Reopen this shipment before editing its email draft.');
    if (!action.subject.trim() || !action.body.trim()) throw new Error('Email subject and body are required.');
    const before = { subject: draft.subject, body: draft.body };
    draft.subject = action.subject.trim(); draft.body = action.body.trim(); draft.updatedAt = at;
    state.audit.push({ id: `audit-${crypto.randomUUID()}`, caseId: draft.caseId, at, actor: actor.name, action: 'email_draft_updated', reason: 'Updated a local draft; no email sent.', before, after: { draftId: draft.id, subject: draft.subject, body: draft.body } });
    return;
  }
  const shipment = state.cases.find(item => item.id === action.caseId && !item.mergedInto);
  if (!shipment || shipment.status === 'completed') throw new Error('Choose an open shipment before drafting questions.');
  const selected = [...new Set(action.issueIds)].map(id => issues.find(issue => issue.id === id && issue.caseId === shipment.id && !issue.resolved));
  if (!selected.length || selected.some(issue => !issue)) throw new Error('These questions changed or were resolved. Refresh the shipment before drafting.');
  const locale = action.locale ?? 'vi';
  const draft = drafts.find(item => item.caseId === shipment.id && item.status === 'draft');
  const additions = (selected as Issue[]).filter(issue => !draft?.issueIds.includes(issue.id));
  if (!additions.length) return;
  const sections = additions.map(issue => {
    const definition = issue.field ? getDeclarationField(issue.field) : undefined;
    const label = definition ? locale === 'en' ? definition.labelEn : definition.labelVi : fieldLabel(issue.field ?? '', locale);
    const evidenceQuestion = reviewQuestion(state, issue);
    const question = !issue.field ? translateIssue(issue, locale).title
      : evidenceQuestion.kind === 'missing' ? locale === 'en' ? `Please provide ${label}; it was not found in the shipment documents.` : `Vui lòng cung cấp ${label}; chưa tìm thấy thông tin này trong chứng từ lô hàng.`
      : evidenceQuestion.kind === 'confirm' ? locale === 'en' ? `Please confirm that ${label} is ${evidenceQuestion.values[0]}.` : `Vui lòng xác nhận ${label} là ${evidenceQuestion.values[0]}.`
      : evidenceQuestion.kind === 'choose' ? locale === 'en' ? `The documents show different values for ${label}: ${evidenceQuestion.values.join(' / ')}. Which value is correct?` : `Các chứng từ ghi ${label} khác nhau: ${evidenceQuestion.values.join(' / ')}. Giá trị nào đúng?`
      : locale === 'en' ? `Please clarify ${label}.` : `Vui lòng làm rõ ${label}.`;
    const evidence = issue.candidateIds.map(id => state.candidates.find(candidate => candidate.id === id)).filter(candidate => candidate && !candidate.lineId).map(candidate => {
      const document = state.documents.find(document => document.id === candidate!.documentId && document.active);
      return document ? `- ${document.name}, ${locale === 'en' ? 'page' : 'trang'} ${candidate!.page}: ${candidate!.value}` : '';
    }).filter(Boolean);
    return [question, ...new Set(evidence)].join('\n');
  });
  let recipient = '';
  const emails = state.emails.filter(email => emailLinkedToCase(state, email, shipment.id));
  const senders = [...new Set(emails.map(email => email.sender.trim()).filter(sender => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)))];
  if (senders.length === 1) recipient = senders[0];
  const subject = locale === 'en' ? `Information needed — ${shipment.reference}` : `Cần bổ sung thông tin — ${shipment.reference}`;
  if (draft) {
    draft.body += `\n\n${sections.join('\n\n')}`;
    draft.issueIds.push(...additions.map(issue => issue.id)); draft.updatedAt = at;
  } else {
    drafts.push({ id: `draft-${crypto.randomUUID()}`, caseId: shipment.id, issueIds: additions.map(issue => issue.id), recipient, subject, body: `${locale === 'en' ? `Hello,\n\nPlease help clarify the following information for shipment ${shipment.reference}:` : `Chào anh/chị,\n\nVui lòng làm rõ các thông tin sau cho lô hàng ${shipment.reference}:`}\n\n${sections.join('\n\n')}\n\n${locale === 'en' ? 'Thank you.' : 'Cảm ơn anh/chị.'}`, status: 'draft', createdBy: actor.name, createdAt: at, updatedAt: at });
  }
  state.audit.push({ id: `audit-${crypto.randomUUID()}`, caseId: shipment.id, at, actor: actor.name, action: 'email_questions_drafted', reason: 'Saved questions as a local draft for human review; no email sent.', after: { draftId: (draft ?? drafts.at(-1))!.id, issueIds: additions.map(issue => issue.id) } });
}
