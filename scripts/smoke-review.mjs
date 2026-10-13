// Synthetic HTTP regression. Run only in a disposable local workspace.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

const base = new URL(process.argv[2] || 'http://127.0.0.1:5174');
if (process.env.AICD_SMOKE_ISOLATED !== '1') throw new Error('Set AICD_SMOKE_ISOLATED=1 only for a disposable workspace.');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Only HTTP loopback is supported.');
const auth = await fetch(new URL('/api/auth/status', base)).then(response => response.json());
assert.equal(auth.mode, 'local');
let workspace = await fetch(new URL('/api/workspace', base)).then(response => response.json());
async function post(path, body, headers = {}) {
  const response = await fetch(new URL(path, base), { method: 'POST', headers: { Origin: base.origin, ...headers }, body });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  workspace = result;
}
async function action(action) {
  await post('/api/workspace', JSON.stringify({ revision: workspace.state.revision, action }), { 'Content-Type': 'application/json' });
}
const reference = `SYNTHETIC-REVIEW-${randomUUID().slice(0, 8)}`;
const text = [
  'COMMERCIAL INVOICE', `Invoice Number: ${reference}`,
  'Importer: Fictional Buyer', 'Exporter: Fictional Seller', 'Vessel: Fictional Vessel',
  'Currency: USD', 'Invoice Total: 60',
  'Description | Quantity | Unit | Unit Price | Amount',
  'Widget A | 1 | PCS | 10 | 10', 'Widget B | 2 | PCS | 10 | 20', 'Widget C | 3 | PCS | 10 | 30',
].join('\n');
const pdf = await PDFDocument.create();
pdf.addPage().drawText(text, { x: 30, y: 780, size: 10, lineHeight: 15 });
const form = new FormData();
const name = `${reference}.pdf`;
form.set('file', new File([await pdf.save()], name, { type: 'application/pdf' }));
form.set('revision', String(workspace.state.revision));
// A controlled OCR result tests uncertainty handling, not OCR accuracy.
form.set('documents', JSON.stringify([{ name, extractionStatus: 'extracted', pages: [{ page: 1, text, textSource: 'ocr', ocrConfidence: 0.9 }] }]));
await post('/api/documents', form);
const document = workspace.state.documents.find(item => item.name === name);
assert(document);
const caseId = document.caseId;
const shipment = () => workspace.state.cases.find(item => item.id === caseId);
const pending = () => workspace.issues.filter(issue => issue.caseId === caseId && !issue.resolved);
const initialPending = pending();
const importer = workspace.state.candidates.find(candidate => candidate.caseId === caseId && candidate.field === 'importer' && !candidate.lineId);
assert(importer);
await action({ type: 'review_field', caseId, field: 'importer', value: importer.value, candidateId: importer.id, reason: 'Synthetic check: verified only the importer.' });
assert(initialPending.filter(issue => issue.field !== 'importer').every(issue => pending().some(current => current.id === issue.id)));
assert.equal(shipment().reviewHistory.length, 1);
assert.equal(shipment().reviewHistory[0].status, 'confirmed');
assert.equal(shipment().reviewHistory[0].issue.field, 'importer');
console.log('PASS one header confirmation preserves every unrelated question');

const rows = shipment().goods;
assert.equal(rows.length, 3);
await action({ type: 'review_goods', caseId, goods: rows.map(row => ({ ...row, reviewed: true })), reviewedLineIds: [], reason: 'Synthetic save only: approval flags in rows must not be trusted.' });
assert(shipment().goods.every(row => !row.reviewed));
assert.equal(shipment().reviewHistory.length, 1);
console.log('PASS saving goods ignores blanket approval flags');

const beforeSecond = pending().find(issue => issue.id.endsWith(`goods-uncertain-${rows[1].id}`));
await action({ type: 'review_goods', caseId, goods: shipment().goods, reviewedLineIds: [rows[0].id], reason: 'Synthetic check: verified only the first goods row.' });
assert.deepEqual(shipment().goods.map(row => row.reviewed), [true, false, false]);
const afterSecond = pending().find(issue => issue.id === beforeSecond.id);
assert.equal(afterSecond.fingerprint, beforeSecond.fingerprint);
assert.equal(shipment().reviewHistory.length, 2);
console.log('PASS confirming one row preserves the other rows and their questions');

const saved = structuredClone(shipment());
workspace = await fetch(new URL('/api/workspace', base)).then(response => response.json());
assert.deepEqual(shipment(), saved);
assert(pending().some(issue => issue.field === 'exporter'));
assert(pending().some(issue => issue.field === 'vessel'));
console.log('PASS completed history and unanswered questions survive reload');
console.log(JSON.stringify({ passed: 4, caseId, reference, revision: workspace.state.revision }));
