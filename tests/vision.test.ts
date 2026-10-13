import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithKimi, groundKimiProposals, kimiRequestSchema, selectKimiPages } from '../lib/kimi.ts';
import { jpegDimensions, sha256Hex, visionBlobKey, VISION_LIMITS } from '../lib/vision.ts';
import type { AiSourceProposal, ShipmentDocument } from '../lib/types.ts';

// JPEG framing stub for boundary tests; no provider is contacted or pixel accuracy claimed.
const jpeg = (width = 100, height = 200) => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
const sha = 'a'.repeat(64);
const source: ShipmentDocument = { id: 'doc-test', caseId: 'case-test', name: 'scan.pdf', mime: 'application/pdf', size: 100, sha256: sha, version: 1, active: true, uploadedAt: '', pages: [{ page: 1, text: '', textSource: 'ocr', ocrConfidence: .2 }], extractionStatus: 'needs_transcription', synthetic: true, type: 'invoice' };
const proposal: AiSourceProposal = { field: 'invoiceNumber', value: 'INV-100', quote: 'Invoice No: INV-100', page: 1, confidence: 'medium', evidence: 'vision', bounds: [.1, .1, .3, .05] };
const evidence = { page: 1, imageSha256: sha, width: 100, height: 200 };

test('page rasters enforce byte, frame, dimension, and storage-namespace bounds', async () => {
  assert.deepEqual(jpegDimensions(jpeg()), { width: 100, height: 200 });
  for (const bytes of [new Uint8Array(), jpeg(0, 100), jpeg(2601, 100), jpeg().slice(0, -1), new Uint8Array(VISION_LIMITS.maxImageBytes + 1)]) assert.throws(() => jpegDimensions(bytes));
  const hash = await sha256Hex(jpeg()); assert.match(hash, /^[a-f0-9]{64}$/);
  const key = visionBlobKey('ws-1', source, 1, hash);
  for (const other of [visionBlobKey('ws-2', source, 1, hash), visionBlobKey('ws-1', { ...source, version: 2 }, 1, hash), visionBlobKey('ws-1', { ...source, sha256: 'b'.repeat(64) }, 1, hash), visionBlobKey('ws-1', source, 2, hash)]) assert.notEqual(key, other);
  assert.throws(() => visionBlobKey('../ws', source, 1, hash));
  assert.throws(() => visionBlobKey('ws-1', source, 0, hash));
  assert.throws(() => visionBlobKey('ws-1', source, 1, 'https://foreign.invalid/image'));
});

test('a blank scanned page becomes eligible only when its rendered image is available', () => {
  assert.throws(() => selectKimiPages(source, [1]));
  assert.deepEqual(selectKimiPages(source, [1], [1]), source.pages);
  assert.throws(() => selectKimiPages(source, [2], [2]), /exist/);
  const request = { revision: 0, caseId: source.caseId, documentId: source.id, pages: [1], consent: true, visionPages: [{ page: 1, imageSha256: sha }] };
  assert.equal(kimiRequestSchema.safeParse(request).success, true);
  assert.equal(kimiRequestSchema.safeParse({ ...request, visionPages: [{ page: 1, imageSha256: sha, url: 'https://foreign.invalid' }] }).success, false);
});

test('visual readings require a sent image and region; OCR disagreements remain low confidence and do not rewrite source text', () => {
  const document = { ...source, pages: [{ page: 1, text: 'Invoice No: INV-1OO', textSource: 'ocr' as const, ocrConfidence: .95 }] };
  assert.equal(groundKimiProposals(document, document.pages, [proposal], 'kimi-k2.6').rejected, 1);
  const result = groundKimiProposals(document, document.pages, [proposal, { ...proposal, bounds: undefined }, { ...proposal, evidence: 'text', bounds: undefined }, { ...proposal, page: 2 }, { ...proposal, field: 'hsCode' }], 'kimi-k2.6', [evidence]);
  assert.equal(result.candidates.length, 1); assert.equal(result.rejected, 4);
  const candidate = result.candidates[0];
  assert.equal(candidate.value, 'INV-100'); assert.equal(candidate.confidence, 'low');
  assert.deepEqual(candidate.visualEvidence, { imageSha256: sha, bounds: proposal.bounds, textAgreement: false });
  assert.equal(document.pages[0].text, 'Invoice No: INV-1OO');
  const agreement = { ...document, pages: [{ ...document.pages[0], text: proposal.quote }] };
  assert.equal(groundKimiProposals(agreement, agreement.pages, [proposal], 'kimi-k2.6', [evidence]).candidates[0].confidence, 'medium');
  assert.throws(() => groundKimiProposals(document, document.pages, [{ ...proposal, bounds: [.9, .1, .3, .1] }], 'kimi-k2.6', [evidence]), /invalid/);
});

test('multimodal Kimi request sends inline JPEG with page binding and no local extraction text, never URLs or credentials in model content', async () => {
  const bytes = jpeg(); const imageSha256 = await sha256Hex(bytes); let calls = 0;
  const result = await extractWithKimi({ apiKey: 'private-test-key' }, source, [1], { images: [{ ...evidence, bytes, imageSha256 }], fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'kimi-k2.6'); assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.max_tokens, 6000); assert.equal(body.temperature, undefined);
    const parts = body.messages[1].content; assert.ok(Array.isArray(parts));
    assert.equal(JSON.parse(parts[0].text).pages[0].text, undefined);
    assert.match(parts[1].text, /Source page 1/); assert.match(parts[2].image_url.url, /^data:image\/jpeg;base64,/);
    assert.ok(!JSON.stringify(body.messages).includes('private-test-key')); assert.ok(!JSON.stringify(body.messages).includes(source.sha256));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [proposal] }) } }] });
  } });
  assert.equal(calls, 1); assert.equal(result.candidates[0].visualEvidence?.imageSha256, imageSha256); assert.equal(result.candidates[0].confidence, 'low');
});

test('unsupported models and unselected images are rejected before a paid request', async () => {
  let calls = 0; const fetch = async () => { calls++; throw new Error('Should not send'); };
  const image = { ...evidence, bytes: jpeg() };
  await assert.rejects(() => extractWithKimi({ apiKey: 'key', model: 'text-only-model' }, source, [1], { images: [image], fetch }), /does not support/);
  await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, source, [1], { images: [image, { ...image, page: 2 }], fetch }), /selected/);
  assert.equal(calls, 0);
});


test('entirely rejected model output cannot mark a page processed', async () => {
  await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, source, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [{ ...proposal, field: 'hsCode' }] }) } }] }) }), /None of the AI suggestions passed/);
});

const kimiSource: ShipmentDocument = { ...source, extractionPipeline: 'kimi', extractionStatus: 'pending_ai' };
const clearProposal: AiSourceProposal = { ...proposal, confidence: 'high', readability: 'clear' };
const reading = { page: 1, documentType: 'invoice', readability: 'clear' };
const modelReply = (pageReadings: unknown, candidates: unknown = [clearProposal]) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ pageReadings, candidates }) } }] });

test('Kimi alone can produce a clear visual fact without agreement from old OCR', async () => {
  const document: ShipmentDocument = { ...kimiSource, pages: [{ page: 1, text: 'OLD OCR: INV-1OO', pdfText: 'OLD PDF TEXT', textSource: 'ocr', ocrConfidence: .1 }] };
  const result = await extractWithKimi({ apiKey: 'key' }, document, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async (_, init) => {
    const messages = JSON.stringify(JSON.parse(String(init?.body)).messages);
    assert.ok(!messages.includes('OLD OCR')); assert.ok(!messages.includes('OLD PDF TEXT'));
    return modelReply([reading]);
  } });
  assert.equal(result.candidates[0].confidence, 'high');
  assert.equal(result.candidates[0].readability, 'clear');
  assert.equal(result.candidates[0].visualEvidence?.textAgreement, false);
  assert.deepEqual(result.pageReadings, [reading]);
  assert.equal(document.pages[0].text, 'OLD OCR: INV-1OO');
});

test('new visual pipeline cannot fall back to stored text or accept text evidence for an image request', async () => {
  let calls = 0;
  const document = { ...kimiSource, pages: [{ page: 1, text: proposal.quote }] };
  await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, document, [1], { fetch: async () => { calls++; return modelReply([reading]); } }), /requires an original page image/);
  assert.equal(calls, 0);
  const result = groundKimiProposals(document, document.pages, [{ ...clearProposal, evidence: 'text', bounds: undefined }], 'kimi-k2.6', [evidence]);
  assert.equal(result.candidates.length, 0); assert.equal(result.rejected, 1);
});

test('page readings must cover exactly the selected original pages before processing completes', async () => {
  for (const pageReadings of [undefined, [], [{ ...reading, page: 2 }], [reading, reading]]) {
    await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, kimiSource, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async () => modelReply(pageReadings) }), /invalid proposal|complete reading/);
  }
  const result = await extractWithKimi({ apiKey: 'key' }, kimiSource, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async () => modelReply([{ ...reading, documentType: 'other' }], []) });
  assert.deepEqual(result.candidates, []); assert.deepEqual(result.pages, [1]);
});

test('uncertain pages and ambiguous printed numbers stay uncertain despite model confidence', async () => {
  const result = await extractWithKimi({ apiKey: 'key' }, kimiSource, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async () => modelReply([{ ...reading, readability: 'uncertain' }]) });
  assert.equal(result.candidates[0].confidence, 'low'); assert.equal(result.candidates[0].readability, 'uncertain');
  const ambiguous = groundKimiProposals(kimiSource, kimiSource.pages, [
    { ...clearProposal, field: 'invoiceDate', value: '03/04/2026', quote: 'Invoice Date: 03/04/2026' },
    { ...clearProposal, field: 'grossWeight', value: '1,234', quote: 'Gross Weight: 1,234' },
  ], 'kimi-k2.6', [evidence]);
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(ambiguous.candidates[0].confidence, 'low');
  assert.notEqual(ambiguous.candidates[1].confidence, 'high');
});
