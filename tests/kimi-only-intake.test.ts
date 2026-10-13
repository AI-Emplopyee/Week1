import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { PDFiumLibrary } from '@hyzyla/pdfium';
import { prepareFile, prepareIntakeFile } from '../lib/client-intake.ts';
import { rasterizePdfPage } from '../lib/pdf-raster.ts';
import { openPdfRasterizer } from '../lib/client-pdf-raster.ts';

test('PDFs and image uploads have no locally extracted facts and wait for Kimi', async () => {
  const pdf = new File(['%PDF-1.7\nhidden text should not become a candidate'], 'invoice.pdf', { type: 'application/pdf' });
  assert.deepEqual(await prepareFile(pdf), { pages: [], extractionStatus: 'pending_ai' });
  assert.deepEqual(await prepareFile(new File(['pixels'], 'scan.png', { type: 'image/png' })), { pages: [{ page: 1, text: '' }], extractionStatus: 'pending_ai' });
  const text = await prepareFile(new File(['Invoice Number: VALUE-1'], 'invoice.txt'));
  assert.equal(text.pages[0].text, 'Invoice Number: VALUE-1');
  assert.equal(text.extractionStatus, 'pending_ai');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(prepareFile(pdf, { signal: abort.signal }), error => error instanceof DOMException && error.name === 'AbortError');
});

test('email attachments wait for Kimi without interpreting their embedded PDF text', async () => {
  const eml = [
    'From: test@example.invalid', 'Subject: Test', 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="test-boundary"', '', '--test-boundary',
    'Content-Type: application/pdf; name="invoice.pdf"', 'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.7\nInvoice: UNSUPPORTED-LOCAL-FACT').toString('base64'), '--test-boundary--', '',
  ].join('\r\n');
  const result = await prepareIntakeFile(new File([eml], 'message.eml', { type: 'message/rfc822' }));
  assert.equal(result.attachments?.length, 1);
  assert.equal(result.attachments?.[0].extractionStatus, 'pending_ai');
  assert.deepEqual(result.attachments?.[0].pages, []);
});

test('PDFium renders real PDF page pixels with page orientation and bounded dimensions', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([200, 100]);
  page.drawRectangle({ x: 0, y: 50, width: 100, height: 50, color: rgb(1, 0, 0) });
  page.drawText('Kimi reads this, no local text extraction', { x: 5, y: 5, size: 6 });
  source.addPage([200, 100]).setRotation(degrees(90));
  const library = await PDFiumLibrary.init();
  const document = await library.loadDocument(await source.save());
  try {
    const raster = await rasterizePdfPage(document, 1, 200);
    assert.equal(raster.width, 200); assert.equal(raster.height, 100);
    assert.equal(raster.data.length, 200 * 100 * 4);
    const pixel = (x: number, y: number) => [...raster.data.subarray((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4)];
    assert.deepEqual(pixel(25, 25), [255, 0, 0, 255]);
    assert.deepEqual(pixel(175, 25), [255, 255, 255, 255]);
    const rotated = await rasterizePdfPage(document, 2, 200);
    assert.equal(rotated.width, 100); assert.equal(rotated.height, 200);
    await assert.rejects(rasterizePdfPage(document, 3), /does not exist/);
    await assert.rejects(rasterizePdfPage(document, 1, 2601), /Invalid/);
  } finally { document.destroy(); library.destroy(); }
});

test('the raster worker uses same-origin Wasm and abort releases a pending renderer', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls: { type: string; wasmUrl?: string }[] = [];
  let terminated = 0;
  class TestWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: { id: number; type: string; wasmUrl?: string }) {
      calls.push(message);
      if (message.type === 'open') queueMicrotask(() => this.onmessage?.({ data: { id: message.id, pageCount: 1 } }));
      // A pending page response deliberately never arrives.
    }
    terminate() { terminated++; }
  }
  try {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: TestWorker });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://aicd.example.invalid' } } });
    const controller = new AbortController();
    const rasterizer = await openPdfRasterizer(new ArrayBuffer(8), controller.signal, { worker: () => new TestWorker() as unknown as Worker });
    assert.equal(calls[0].wasmUrl, 'https://aicd.example.invalid/pdfium/pdfium.wasm');
    const pending = rasterizer.render(1);
    controller.abort();
    await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(terminated, 1);
    assert.deepEqual(calls.map(call => call.type), ['open', 'render']);
    rasterizer.close(); assert.equal(terminated, 1);
  } finally {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker); else Reflect.deleteProperty(globalThis, 'Worker');
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
