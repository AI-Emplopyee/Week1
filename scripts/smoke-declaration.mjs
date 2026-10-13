// Writes synthetic records only in an explicitly designated disposable workspace.
import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'http://127.0.0.1:5174');
if (process.env.AICD_SMOKE_ISOLATED !== '1') throw new Error('Set AICD_SMOKE_ISOLATED=1 only after starting a disposable local workspace. Never run this script against your shipment records.');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Only a loopback development server is supported.');
const auth = await fetch(new URL('/api/auth/status', base)).then(r => r.json());
assert.equal(auth.mode, 'local');
let workspace = await fetch(new URL('/api/workspace', base)).then(r => r.json());
const results = [];
const pass = name => { results.push(name); console.log(`PASS ${name}`); };
async function post(action, expected = 200, revision = workspace.state.revision) {
  const response = await fetch(new URL('/api/workspace', base), { method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, action }) });
  const body = await response.json();
  assert.equal(response.status, expected, `${action.type}: ${body.error || JSON.stringify(body)}`);
  if (expected === 200) workspace = body;
  return body;
}
const title = 'DEMO structured declaration — synthetic HTTP verification';
if (!workspace.state.cases.some(c => c.title === title)) await post({ type: 'create_case', title });
const caseId = workspace.state.cases.find(c => c.title === title).id;
const shipment = () => workspace.state.cases.find(c => c.id === caseId);
const reason = 'Synthetic software check only; no broker or customs validation claimed.';
if (shipment().status !== 'review') await post({ type: 'reopen', caseId, reason });
for (const entry of [...(shipment().declarationDraft?.fields || [])]) await post({ type: 'remove_declaration_field', caseId, fieldId: entry.fieldId, ...(entry.goodsLineId ? { goodsLineId: entry.goodsLineId } : {}), reason });
const save = (fieldId, value, extra = {}) => ({ type: 'save_declaration_field', caseId, fieldId, applicability: 'applicable', basis: reason, value, provenance: [{ kind: 'manual', note: reason }], reason, review: true, ...extra });
const entry = fieldId => shipment().declarationDraft.fields.find(e => e.fieldId === fieldId);
await post(save('1.44', { kind: 'invoice', priceCategoryCode: '', incotermCode: 'DEMO', currencyCode: 'USD', amount: '1,234' }, { applicability: 'unresolved', review: false }));
assert.equal(entry('1.44').value.amount, '1,234');
assert.equal(entry('1.44').review, null);
assert(workspace.issues.some(i => i.caseId === caseId && i.kind === 'declaration'));
await post(save('1.44', entry('1.44').value), 422);
await post(save('1.44', { kind: 'invoice', priceCategoryCode: '', incotermCode: 'DEMO', currencyCode: 'USD', amount: '1234.000000000000000001' }));
assert.equal(entry('1.44').review.actorId, workspace.actor.id);
assert.equal(entry('1.44').codeVerification, 'unverified');
const auditBefore = JSON.stringify(workspace.state.audit.filter(a => a.caseId === caseId));
pass('unfinished draft persists; explicit review enforces integrity and records server identity');

await post({ ...save('1.4', { kind: 'code', code: 'DEMO-UNVERIFIED' }), updatedBy: 'forged' }, 400);
await post(save('1.1', { kind: 'blocked', note: 'forged customs value' }), 422);
await post(save('1.46', { kind: 'blocked', note: 'invented unnamed cell' }), 422);
await post(save('1.26', { kind: 'reference_rows', rows: [{ id: 'duplicate', reference: 'A' }, { id: 'duplicate', reference: 'B' }] }), 422);
pass('forged metadata, customs-owned values, deferred cells and duplicate row identities rejected');

await post({ type: 'review_goods', caseId, goods: [{ id: 'demo-declaration-goods', description: 'DEMO fictional widget', quantity: '2', unit: 'DEMO', unitPrice: '5', amount: '10', hsCode: '', origin: '', dutyRate: '', vatRate: '', reviewed: false, manual: true }], reason });
assert.equal(entry('1.44').stale, false, 'An unrelated goods edit must preserve the reviewed manual invoice value.');
assert.equal(entry('1.44').value.amount, '1234.000000000000000001');
assert.equal(JSON.stringify(workspace.state.audit.filter(a => JSON.parse(auditBefore).some(old => old.id === a.id))), auditBefore);
await post(save('1.94', { kind: 'tax_rows', rows: [{ id: 'demo-tax-row', taxCode: 'DEMO-TAX', rateCode: '' }] }, { goodsLineId: 'demo-declaration-goods' }));
await post(save('1.95', { kind: 'tax_relief_rows', rows: [{ id: 'demo-relief-row', taxRowId: 'demo-tax-row', reliefCode: 'DEMO-RELIEF' }] }, { goodsLineId: 'demo-declaration-goods' }));
await post(save('1.94', { kind: 'tax_rows', rows: [{ id: 'different-tax-row', taxCode: 'DEMO-TAX-2', rateCode: '' }] }, { goodsLineId: 'demo-declaration-goods' }));
assert.equal(entry('1.95').value.rows[0].taxRowId, 'demo-tax-row');
assert.equal(entry('1.95').stale, true);
await post(save('1.95', entry('1.95').value, { goodsLineId: 'demo-declaration-goods' }), 422);
await post(save('1.95', { kind: 'tax_relief_rows', rows: [{ id: 'demo-relief-row', taxRowId: 'different-tax-row', reliefCode: 'DEMO-RELIEF' }] }, { goodsLineId: 'demo-declaration-goods' }));
pass('unrelated goods edits preserve header review; changed repeated-row links require repair');

const revision = workspace.state.revision;
await post(save('1.42', { kind: 'date', date: '2026-02-28' }));
const conflict = await post(save('1.42', { kind: 'date', date: '2026-03-01' }), 409, revision);
assert.equal(conflict.state.cases.find(c => c.id === caseId).declarationDraft.fields.find(e => e.fieldId === '1.42').value.date, '2026-02-28');
const reloaded = await fetch(new URL('/api/workspace', base)).then(r => r.json());
assert.deepEqual(reloaded.state.cases.find(c => c.id === caseId).declarationDraft, shipment().declarationDraft);
pass('revision conflict returns current draft; a fresh request reopens all saved components');

await post({ type: 'review_goods', caseId, goods: [{ ...shipment().goods[0], id: 'demo-replacement-goods' }], reason });
assert(workspace.issues.some(i => i.caseId === caseId && i.kind === 'declaration' && i.id.includes('orphan')));
const orphanedEntries = shipment().declarationDraft.fields.filter(item => item.goodsLineId === 'demo-declaration-goods');
assert(orphanedEntries.some(item => item.fieldId === '1.94'));
for (const item of orphanedEntries) await post({ type: 'remove_declaration_field', caseId, fieldId: item.fieldId, goodsLineId: item.goodsLineId, reason });
assert(!workspace.issues.some(i => i.caseId === caseId && i.kind === 'declaration' && i.id.includes('orphan')));
assert(workspace.state.audit.some(a => a.caseId === caseId && a.action === 'declaration_field_removed' && a.before?.goodsLineId === 'demo-declaration-goods'));
// Leave valid, reviewed header examples for reopening; this case still lacks pilot source documents.
await post(save('1.44', entry('1.44').value));
await post(save('1.42', entry('1.42').value));
pass('orphan entries remain visible until explicit audited removal');
console.log(JSON.stringify({ passed: results.length, caseId, revision: workspace.state.revision, results }, null, 2));
