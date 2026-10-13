import { PDFiumLibrary, type PDFiumDocument } from '@hyzyla/pdfium';
import { rasterizePdfPage } from './pdf-raster.ts';

type RasterRequest = { id: number; type: 'open'; bytes: ArrayBuffer; wasmUrl: string } | { id: number; type: 'render'; page: number };
let library: PDFiumLibrary | undefined;
let document: PDFiumDocument | undefined;

// A dedicated worker keeps PDF parsing off the UI thread. Its owner terminates
// the whole worker on timeout, abort, or close, releasing all native memory.
self.addEventListener('message', async (event: MessageEvent<RasterRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'open') {
      if (library) throw new Error('A PDF is already open.');
      library = await PDFiumLibrary.init({ wasmUrl: request.wasmUrl });
      document = await library.loadDocument(new Uint8Array(request.bytes));
      self.postMessage({ id: request.id, pageCount: document.getPageCount() });
    } else {
      if (!document) throw new Error('The PDF is not open.');
      const raster = await rasterizePdfPage(document, request.page);
      self.postMessage({ id: request.id, raster }, { transfer: [raster.data.buffer] });
    }
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'The PDF could not be rendered.' });
  }
});
