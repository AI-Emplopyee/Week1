// Writes synthetic records only in an explicitly designated disposable workspace.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const origin = process.argv[2] || 'http://127.0.0.1:5174';
if (process.env.AICD_SMOKE_ISOLATED !== '1') throw new Error('Set AICD_SMOKE_ISOLATED=1 only after starting a disposable local workspace. Never run this script against your shipment records.');
const base = new URL(origin);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('This smoke test is restricted to an HTTP loopback preview.');
const results = [];
const pass = (name, detail = '') => { results.push({ test: name, passed: true, detail }); console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`); };
const fixture = name => readFile(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const auth = await fetch(new URL('/api/auth/status', base)).then(response => response.json());
assert.equal(auth.mode, 'local', 'This fixture runner requires npm run local. It never signs in or sends external requests.');
assert.equal(auth.authenticated, true);
assert.equal((await fetch(new URL('/api/workspace', base))).status, 200);
const remoteOrigin = await fetch(new URL('/api/workspace', base), { headers: { Origin: 'https://untrusted.invalid' } });
assert.equal(remoteOrigin.status, 403);
const forwarded = await fetch(new URL('/api/workspace', base), { headers: { 'X-Forwarded-For': '203.0.113.1' } });
assert.equal(forwarded.status, 403);
pass('local-only identity and request boundary', 'Direct loopback access; external Origin and forwarded requests rejected');
async function request(path, options = {}) {
  return fetch(new URL(path, base), { ...options, headers: { Origin: base.origin, ...options.headers } });
}
async function json(path, options = {}) {
  const response = await request(path, options);
  const body = await response.json();
  return { response, body };
}
let workspace = (await json('/api/workspace')).body;
assert(workspace.state && workspace.actor);
if (!workspace.state.documents.some(doc => doc.synthetic)) {
  const seeded = await json('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: workspace.state.revision, action: { type: 'seed_demo' } }) });
  assert.equal(seeded.response.status, 200, seeded.body.error);
  workspace = seeded.body;
}
async function action(action) {
  const { response, body } = await json('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: workspace.state.revision, action }) });
  assert.equal(response.status, 200, `${action.type}: ${body.error || JSON.stringify(body)}`);
  workspace = body;
  return body;
}
const invoice = workspace.state.candidates.find(candidate => candidate.field === 'invoiceNumber' && candidate.value === 'DEMO-INV-022' && candidate.documentId === 'demo-ready-invoice');
assert(invoice, 'The labelled DEMO-INV-022 seed case was not found.');
const caseId = invoice.caseId;
const currentCase = () => workspace.state.cases.find(item => item.id === caseId);
if (currentCase().status !== 'review' || currentCase().approval) await action({ type: 'reopen', caseId, reason: 'DEMO API integration verification: reopen synthetic shipment for a fresh test snapshot.' });
await action({ type: 'update_case', caseId, assignedTo: workspace.actor.name });
const activeVersions = new Set(workspace.state.documents.filter(doc => doc.caseId === caseId && doc.active).map(doc => `${doc.id}:${doc.version}`));
const headers = new Map();
for (const candidate of workspace.state.candidates.filter(candidate => candidate.caseId === caseId && !candidate.lineId && activeVersions.has(`${candidate.documentId}:${candidate.documentVersion}`))) {
  if (!headers.has(candidate.field)) headers.set(candidate.field, candidate);
}
for (const candidate of headers.values()) await action({ type: 'review_field', caseId, field: candidate.field, value: candidate.value, candidateId: candidate.id, reason: 'DEMO API integration verification: compared deterministic synthetic fixture evidence.' });
await action({ type: 'confirm_grouping', caseId, reason: 'DEMO API integration verification: invoice, packing list and bill of lading identify the same fictional shipment.' });
await action({ type: 'review_goods', caseId, goods: currentCase().goods, reviewedLineIds: currentCase().goods.map(line => line.id), reason: 'DEMO API integration verification: quantities and invoice arithmetic match the fictional source table.' });
// The combined declaration now includes gross weight. The historical fixture
// omits the unit, so a reviewer explicitly supplies a fictional test unit.
const draftWeight = currentCase().declarationDraft?.fields.find(entry => entry.fieldId === '1.28');
if (draftWeight && !draftWeight.value.unitCode) await action({ type: 'save_declaration_field', caseId, fieldId: '1.28', applicability: 'applicable', basis: 'Synthetic test fixture: reviewer supplies the omitted gross-weight unit; not a customs-code validation.', value: { ...draftWeight.value, unitCode: 'KGM' }, provenance: [...draftWeight.provenance, { kind: 'manual', note: 'Synthetic fixture review: gross weight is expressed in kilograms for this test.' }], reason: 'Synthetic fixture unit explicitly supplied by the reviewer.', review: true });
assert.equal(workspace.issues.filter(issue => issue.caseId === caseId && !issue.resolved).length, 0);
await action({ type: 'approve', caseId });
assert.equal(currentCase().status, 'approved');
const snapshotId = currentCase().approval.snapshotId;
assert(workspace.state.snapshots.some(snapshot => snapshot.id === snapshotId));
pass('field and goods review, grouping and immutable approval', `${headers.size} header fields`);
await action({ type: 'handoff', caseId, simulateFailure: true });
assert.equal(workspace.state.handoffs.filter(run => run.caseId === caseId).at(-1).status, 'failed');
assert(workspace.issues.some(issue => issue.caseId === caseId && issue.kind === 'transfer' && !issue.resolved));
await action({ type: 'handoff', caseId });
const success = workspace.state.handoffs.filter(run => run.caseId === caseId).at(-1);
assert.equal(success.status, 'succeeded');
assert.equal(success.idaStatus, 'not_transmitted');
assert.equal(success.idcStatus, 'not_registered');
assert.equal(success.customsOutcome, 'not_assessed');
const runCount = workspace.state.handoffs.length;
await action({ type: 'handoff', caseId });
assert.equal(workspace.state.handoffs.length, runCount);
assert.equal(workspace.state.handoffs.at(-1).draftReference, success.draftReference);
pass('simulated handoff failure, retry and idempotency', 'No IDA or IDC transmission');
await action({ type: 'complete', caseId, reason: 'DEMO API integration verification: responsible reviewer completed the fictional test workflow.' });
assert.equal(currentCase().status, 'completed');
await action({ type: 'reopen', caseId, reason: 'DEMO API integration verification: restore the synthetic shipment for the product demonstration.' });
assert.equal(currentCase().status, 'review');
assert.equal(currentCase().approval, undefined);
await action({ type: 'approve', caseId });
await action({ type: 'handoff', caseId });
assert.equal(currentCase().status, 'approved');
pass('responsible reviewer completion and reopen', 'Left approved with successful TEST draft');

const smokeTitle = 'DEMO API verification — preserved original evidence';
let smokeCase = workspace.state.cases.find(item => item.title === smokeTitle);
if (!smokeCase) { await action({ type: 'create_case', title: smokeTitle }); smokeCase = workspace.state.cases.find(item => item.title === smokeTitle); }
async function upload(name, bytes, pages = [], targetCaseId = smokeCase.id) {
  const form = new FormData();
  form.set('file', new File([bytes], name));
  form.set('pages', JSON.stringify(pages));
  form.set('revision', String(workspace.state.revision));
  form.set('targetCaseId', targetCaseId);
  const { response, body } = await json('/api/documents', { method: 'POST', body: form });
  assert.equal(response.status, 200, `${name}: ${body.error}`);
  workspace = body;
  return body;
}
const emlBytes = await fixture('DEMO-shipment-email.eml');
await upload('DEMO-shipment-email.eml', emlBytes);
const email = workspace.state.emails.find(item => item.sha256 === sha(emlBytes));
assert(email);
assert.equal(email.sender, 'demo-supplier@example.invalid');
assert.equal(email.documentIds.length, 3);
const emlOriginal = await request(`/api/emails/${email.id}`);
assert.equal(emlOriginal.status, 200);
assert.equal(sha(Buffer.from(await emlOriginal.arrayBuffer())), sha(emlBytes));
const emailCount = workspace.state.emails.length;
const emailRevision = workspace.state.revision;
await upload('DEMO-shipment-email.eml', emlBytes);
assert.equal(workspace.state.emails.length, emailCount);
assert.equal(workspace.state.revision, emailRevision);
pass('EML envelope, attachment linking, original preservation and duplicate idempotency', 'Original download matches SHA-256');

const pdfBytes = await fixture('DEMO-commercial-invoice-022.pdf');
const textBytes = await fixture('DEMO-commercial-invoice-022.txt');
await upload('DEMO-commercial-invoice-022.pdf', pdfBytes, [{ page: 1, text: textBytes.toString('utf8') }]);
const pdf = workspace.state.documents.find(item => item.sha256 === sha(pdfBytes));
assert(pdf && pdf.blobKey);
assert.equal(pdf.pages.length, 1);
assert.equal(pdf.extractionStatus, 'extracted');
const pdfOriginal = await request(`/api/documents/${pdf.id}?download=1`);
assert.equal(pdfOriginal.status, 200);
assert.equal(sha(Buffer.from(await pdfOriginal.arrayBuffer())), sha(pdfBytes));
assert.match(pdfOriginal.headers.get('cache-control'), /no-store/);
pass('PDF physical pages, evidence intake and private original download', 'Original download matches SHA-256');

const staleRevision = workspace.state.revision;
const write = () => json('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: staleRevision, action: { type: 'update_case', caseId: smokeCase.id, assignedTo: workspace.actor.name } }) });
const concurrent = await Promise.all([write(), write()]);
assert.deepEqual(concurrent.map(result => result.response.status).sort(), [200, 409]);
const conflict = concurrent.find(result => result.response.status === 409).body;
assert(conflict.state && conflict.actor && conflict.issues);
workspace = (await json('/api/workspace')).body;
assert.equal(workspace.state.revision, staleRevision + 1);
pass('concurrent revision conflict', 'One committed; one 409 with current state');
const malformed = await json('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: workspace.state.revision, action: { type: 'settings', role: 'owner' } }) });
assert.equal(malformed.response.status, 400);
assert.equal((await request('/api/documents/doc_does_not_exist')).status, 404);
const crossOrigin = await request('/api/workspace', { method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: workspace.state.revision, action: { type: 'seed_demo' } }) });
assert.equal(crossOrigin.status, 403);
pass('malformed action, nonexistent document and cross-origin mutation rejection', '400 / 404 / 403');
assert.equal(currentCase().status, 'approved');
assert.equal(workspace.state.handoffs.filter(run => run.snapshotId === currentCase().approval.snapshotId).at(-1).status, 'succeeded');
console.log(JSON.stringify({ passed: results.length, caseId, demoReference: currentCase().reference, revision: workspace.state.revision, stateBytes: Buffer.byteLength(JSON.stringify(workspace.state)), results }, null, 2));
