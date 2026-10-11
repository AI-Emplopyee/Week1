import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { acceptedFile, parseMutation, parsePages, safeFilename, sameOrigin } from '../lib/server-validation.ts';
import { COMMIT_SQL, commitSucceeded } from '../lib/server-persistence.ts';
import { PDFDocument } from 'pdf-lib';
import { boundedPdfPages } from '../lib/pdf-pages.ts';
import { assessExtraction } from '../lib/extraction-quality.ts';

test('clients cannot submit full state, file records, role escalation or bypass audit reasons', () => {
  assert.throws(() => parseMutation({ revision: 1, state: { role: 'owner' } }));
  assert.throws(() => parseMutation({ revision: 1, action: { type: 'intake', documents: [] } }));
  assert.throws(() => parseMutation({ revision: 1, action: { type: 'replace_document', documentId: 'doc_a', document: {} } }));
  assert.throws(() => parseMutation({ revision: 1, action: { type: 'settings', role: 'owner' } }));
  assert.throws(() => parseMutation({ revision: -1, action: { type: 'seed_demo' } }));
  assert.throws(() => parseMutation({ revision: 1, action: { type: 'review_field', caseId: 'case_a', field: 'invoiceNumber', value: 'INV-1', reason: '' } }));
});

test('valid engine evidence IDs survive transport validation', () => {
  const payload = parseMutation({ revision: 2, action: { type: 'review_field', caseId: 'case_a', field: 'invoiceNumber', value: 'INV-1', candidateId: 'doc_a:v1:1:1', reason: 'Verified against original page.' } });
  assert.equal(payload.action.type, 'review_field');
  assert.doesNotThrow(() => parseMutation({ revision: 2, action: { type: 'review_goods', caseId: 'case_a', reason: 'Checked invoice.', goods: [{ id: 'doc_a:p1:l9', description: 'Item', quantity: '1', unit: 'EA', unitPrice: '10', amount: '10', hsCode: '', origin: '', dutyRate: '', vatRate: '', reviewed: true, manual: false }] } }));
});

test('cross-origin writes and missing-origin non-browser calls are rejected', () => {
  assert.equal(sameOrigin(new Request('https://aicd.example/api/workspace', { headers: { origin: 'https://evil.example' } })), false);
  assert.equal(sameOrigin(new Request('https://aicd.example/api/workspace')), false);
  assert.equal(sameOrigin(new Request('https://aicd.example/api/workspace', { headers: { origin: 'https://aicd.example', 'sec-fetch-site': 'cross-site' } })), false);
  assert.equal(sameOrigin(new Request('https://aicd.example/api/workspace', { headers: { origin: 'https://aicd.example' } })), true);
});

test('upload validation checks bytes, extensions, filenames, and bounded pages', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\nexample');
  assert.equal(acceptedFile('invoice.PDF', pdf).mime, 'application/pdf');
  assert.throws(() => acceptedFile('invoice.pdf', new TextEncoder().encode('<script>not a pdf</script>')));
  assert.throws(() => acceptedFile('invoice.xlsx', pdf));
  assert.throws(() => acceptedFile('empty.txt', new Uint8Array()));
  assert.equal(safeFilename('../../unsafe\nfile.pdf'), '.._.._unsafe_file.pdf');
  assert.throws(() => parsePages([{ page: 1, text: 'one' }, { page: 1, text: 'duplicate' }]));
  assert.throws(() => parsePages([{ page: 51, text: 'too many' }]));
  assert.throws(() => parsePages([{ page: 1, text: 'a'.repeat(300_000) }, { page: 2, text: 'b'.repeat(300_000) }]));
  assert.equal(parsePages([{ page: 1, text: 'a'.repeat(50_000) }]).length, 1);
});

test('SQLite compare-and-swap commits state and audit atomically and rejects stale or foreign writers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY, revision INTEGER, state_json TEXT, updated_at TEXT); CREATE TABLE workspace_members (workspace_id TEXT, user_id TEXT);');
    db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?)').run('ws_a', 0, '{"audit":[]}', 'now');
    db.prepare('INSERT INTO workspace_members VALUES (?, ?)').run('ws_a', 'alice');
    db.prepare('INSERT INTO workspace_members VALUES (?, ?)').run('ws_b', 'mallory');
    const commit = db.prepare(COMMIT_SQL);
    assert.equal(commit.run('{"audit":[{"id":"forged"}]}', 1, 'now', 'ws_a', 0, 'mallory').changes, 0);
    assert.equal(commit.run('{"audit":[{"id":"approved"}]}', 1, 'now', 'ws_a', 0, 'alice').changes, 1);
    assert.equal(commit.run('{"audit":[{"id":"stale"}]}', 1, 'later', 'ws_a', 0, 'alice').changes, 0);
    const row = db.prepare('SELECT revision, state_json FROM workspaces WHERE id = ?').get('ws_a');
    assert.equal(row?.revision, 1);
    assert.deepEqual(JSON.parse(String(row?.state_json)).audit, [{ id: 'approved' }]);
    assert.equal(commitSucceeded({ meta: { changes: 0 } }), false);
    assert.equal(commitSucceeded({ meta: { changes: 1 } }), true);
  } finally { db.close(); }
});

test('physical PDF pages preserve missing-page blockers and constrain evidence page references', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage(); pdf.addPage();
  const bytes = await pdf.save();
  assert.deepEqual(await boundedPdfPages(bytes, [{ page: 1, text: 'First page text' }]), [{ page: 1, text: 'First page text' }, { page: 2, text: '' }]);
  await assert.rejects(() => boundedPdfPages(bytes, [{ page: 3, text: 'Forged page' }]), /outside this PDF/);
  for (let i = 0; i < 49; i++) pdf.addPage();
  await assert.rejects(() => pdf.save().then(bytes => boundedPdfPages(bytes)), /50 pages/);
});

test('page provenance survives PDF page validation and OCR confidence is finite and bounded', async () => {
  const pages = parsePages([{ page: 1, text: 'Synthetic OCR invoice', textSource: 'ocr', ocrConfidence: 0.72, documentType: 'invoice' }]);
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const restored = await boundedPdfPages(await pdf.save(), pages);
  assert.deepEqual(restored[0], pages[0]);
  assert.deepEqual(restored[1], { page: 2, text: '' });
  for (const confidence of [-0.1, 1.1, NaN, Infinity]) assert.throws(() => parsePages([{ page: 1, text: 'Synthetic', textSource: 'ocr', ocrConfidence: confidence }]));
  assert.throws(() => parsePages([{ page: 1, text: 'Synthetic', textSource: 'pdf_text', ocrConfidence: 0.99 }]));
  assert.throws(() => parsePages([{ page: 1, text: 'Synthetic', textSource: 'untrusted-ai' }]));
});

test('server extraction quality overrides falsely complete OCR and preserves browser diagnostics', () => {
  const pages = [
    { page: 1, text: 'Synthetic readable invoice page', textSource: 'ocr' as const, ocrConfidence: 0.92 },
    { page: 2, text: 'Synthetic uncertain packing page', textSource: 'ocr' as const, ocrConfidence: 0.59 },
  ];
  const assessed = assessExtraction(pages, 'extracted', 'OCR worker reported an uncertain column.');
  assert.equal(assessed.extractionStatus, 'needs_transcription');
  assert.match(assessed.extractionError!, /^Trang 2 /);
  assert.match(assessed.extractionError!, /\nOCR worker reported an uncertain column\.$/);
  assert.equal(assessExtraction([{ ...pages[0], ocrConfidence: undefined }], 'extracted').extractionStatus, 'needs_transcription');
  assert.equal(assessExtraction([{ ...pages[0], ocrConfidence: 0.6 }], 'extracted').extractionStatus, 'extracted');
  assert.equal(assessExtraction([pages[0]], 'needs_transcription', 'Worker could not finish.').extractionStatus, 'needs_transcription');
  assert.equal(assessExtraction([{ page: 1, text: 'X', textSource: 'manual' }]).extractionStatus, 'extracted');
});
