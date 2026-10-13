import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import type { Action } from '../lib/types.ts';
const actor = { id: 'reviewer-a', name: 'Reviewer A', email: 'reviewer@example.invalid' };
const create = () => {
  let state = applyAction(createEmptyWorkspace('test-ws'), { type: 'intake', documents: [{ id: 'invoice-test', name: 'invoice.txt', mime: 'text/plain', size: 100, sha256: 'invoice-test', extractionStatus: 'extracted', pages: [{ page: 1, text: 'COMMERCIAL INVOICE\nInvoice No: SYNTHETIC-42\nGross Weight: 10 KG' }] }] }, actor);
  state = applyAction(state, { type: 'confirm_grouping', caseId: state.cases[0].id, reason: 'Synthetic fixture: this single document is a shipment.' }, actor);
  return state;
};

test('questions become editable local drafts; duplicates do not append and no send action exists', () => {
  let state = create(); const caseId = state.cases[0].id; const issue = getIssues(state, caseId).find(issue => issue.kind === 'missing' && issue.field)!;
  assert.ok(issue);
  const action: Action = { type: 'draft_questions', caseId, issueIds: [issue.id], locale: 'en' };
  state = applyAction(state, action, actor); assert.equal(state.emailDrafts?.length, 1);
  const draft = state.emailDrafts![0]; assert.equal(draft.status, 'draft'); assert.equal(draft.recipient, ''); assert.match(draft.body, /Please provide .*not found/);
  state = applyAction(state, action, actor); assert.equal(state.emailDrafts?.length, 1); assert.equal(state.emailDrafts![0].body, draft.body);
  state = applyAction(state, { type: 'save_email_draft', draftId: draft.id, subject: 'Reviewed subject', body: 'Reviewed question' }, actor);
  assert.equal(state.emailDrafts![0].body, 'Reviewed question'); assert.equal(state.audit.at(-1)?.actor, actor.name);
  assert.throws(() => applyAction(state, { ...action, issueIds: ['another-case:missing'] }, actor));
});

test('questions cannot be drafted from a resolved finding and unknown drafts cannot be edited', () => {
  const state = create();
  assert.throws(() => applyAction(state, { type: 'save_email_draft', draftId: 'missing', subject: 'S', body: 'B' }, actor));
  assert.throws(() => applyAction(state, { type: 'draft_questions', caseId: state.cases[0].id, issueIds: [] }, actor));
});
