import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichIntakeWithKimi } from '../lib/intake-ai.ts';
import { parseIntakeMetadata } from '../lib/intake-metadata.ts';
import { groundKimiProposals } from '../lib/kimi.ts';
import type { UploadedDocument, ShipmentDocument } from '../lib/types.ts';
const document = (id: string, count = 1): UploadedDocument => ({ id, name: `${id}.pdf`, mime: 'application/pdf', size: 100, sha256: id, extractionStatus: 'extracted', pages: Array.from({ length: count }, (_, i) => ({ page: i + 1, text: `Invoice No: ${id}-${i + 1}`, textSource: 'pdf_text' })) });
const config = { apiKey: 'synthetic-key-not-real', model: 'synthetic-model' };

test('one intake metadata record is required per original; forged AI/manual claims are rejected', () => {
  const value = { name: 'one.pdf', pages: [{ page: 1, text: 'invoice' }], extractionStatus: 'extracted' };
  assert.equal(parseIntakeMetadata([value], ['one.pdf']).length, 1);
  assert.throws(() => parseIntakeMetadata([value], ['two.pdf']));
  assert.throws(() => parseIntakeMetadata([value], ['one.pdf', 'two.pdf']));
  assert.throws(() => parseIntakeMetadata([{ ...value, aiCandidates: [] }], ['one.pdf']));
  assert.throws(() => parseIntakeMetadata([{ ...value, pages: [{ page: 1, text: 'value', textSource: 'manual' }] }], ['one.pdf']));
  assert.throws(() => parseIntakeMetadata([{ ...value, attachments: [{ ...value, index: 0 }, { ...value, index: 0 }] }], ['one.pdf']));
});

test('missing Kimi configuration preserves local evidence without making requests', async () => {
  const docs = [document('one')]; const before = structuredClone(docs[0].pages);
  await enrichIntakeWithKimi(docs, {}, { extract: async () => { throw new Error('Must never be called'); } });
  assert.equal(docs[0].aiStatus, 'unavailable'); assert.deepEqual(docs[0].pages, before);
});

test('bounded AI processing gives each document a first pass and labels unfinished pages honestly', async () => {
  const docs = [document('long', 12), document('short')]; const calls: string[] = [];
  await enrichIntakeWithKimi(docs, config, { maxRequests: 2, extract: async (_config, doc, pages) => {
    calls.push(doc.id); return { candidates: [], rejected: 0, proposals: [], model: config.model, pages: pages! };
  } });
  assert.deepEqual(calls, ['long', 'short']); assert.equal(docs[0].aiStatus, 'partial'); assert.equal(docs[1].aiStatus, 'completed');
});

test('AI provider failure preserves originals and never retries or exposes provider error contents', async () => {
  const docs = [document('one', 8)]; let calls = 0;
  await enrichIntakeWithKimi(docs, config, { extract: async () => { calls++; throw new Error('private-provider-payload'); } });
  assert.equal(calls, 1); assert.equal(docs[0].aiStatus, 'failed'); assert.equal(docs[0].pages.length, 8);
  assert.ok(!JSON.stringify(docs).includes('private-provider-payload'));
});

test('AI goods are literal row-scoped proposals; header/row confusion and invented cells are rejected', () => {
  const doc: ShipmentDocument = { ...document('invoice'), type: 'invoice', caseId: 'case-a', active: true, version: 1, uploadedAt: '', synthetic: true, pages: [{ page: 1, text: 'Goods A | 2 | EA | 10.00 | 20.00' }] };
  const result = groundKimiProposals(doc, doc.pages, [
    { field: 'description', value: 'Goods A', quote: doc.pages[0].text, page: 1, confidence: 'medium', rowIndex: 1 },
    { field: 'quantity', value: '2', quote: doc.pages[0].text, page: 1, confidence: 'medium', rowIndex: 1 },
    { field: 'amount', value: '30.00', quote: doc.pages[0].text, page: 1, confidence: 'medium', rowIndex: 1 },
    { field: 'invoiceNumber', value: 'Goods A', quote: doc.pages[0].text, page: 1, confidence: 'medium', rowIndex: 1 },
    { field: 'description', value: 'Goods A', quote: doc.pages[0].text, page: 1, confidence: 'medium' },
  ], config.model);
  assert.equal(result.candidates.length, 2); assert.equal(result.rejected, 3);
  assert.equal(result.candidates[0].lineId, result.candidates[1].lineId);
});
