import type { SourcePage, ShipmentDocument } from './types';
import { reconstructPdfText } from './pdf-text.ts';
import { createLocalOcr, throwIfAborted, type IntakeOptions } from './client-ocr.ts';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 50;
type PreparedFile = { pages: SourcePage[]; extractionStatus: ShipmentDocument['extractionStatus']; extractionError?: string };

/** Prevents a stalled local worker from leaving the intake dialog pending indefinitely. */
export async function withIntakeTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Reads locally in this browser. No document is sent to an external AI/OCR provider. */
export async function prepareFile(file: File, options: IntakeOptions = {}): Promise<PreparedFile> {
  throwIfAborted(options.signal);
  if (file.size > MAX_FILE_BYTES) throw new Error('Tệp vượt quá giới hạn 20 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (['txt', 'csv'].includes(extension || '')) {
    const text = await file.text();
    if (text.length > 300_000) throw new Error('Tài liệu quá dài; giới hạn 300.000 ký tự mỗi tệp.');
    const pages = text.split('\f').map((text, index) => ({ page: index + 1, text }));
    if (pages.length > MAX_PAGES) throw new Error('Tài liệu vượt quá 50 trang. Hãy tách thành tệp nhỏ hơn.');
    return { pages, extractionStatus: text.trim() ? 'extracted' : 'needs_transcription' };
  }
  if (extension === 'eml') return { pages: [], extractionStatus: 'needs_transcription' };
  if (extension === 'pdf') {
    const pdfjs = await withIntakeTimeout(import('pdfjs-dist'), 30_000, 'Trình đọc PDF không khởi động trong 30 giây.');
    // The worker is served from this application's own origin, never a third-party CDN.
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const ocr = createLocalOcr(options);
    let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | undefined;
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | undefined;
    let pages: SourcePage[] = [];
    try {
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
      pdf = await withIntakeTimeout(loadingTask.promise, 30_000, 'Không đọc được PDF trong 30 giây.');
      if (pdf.numPages > MAX_PAGES) throw new Error('Tài liệu vượt quá 50 trang. Hãy tách thành tệp nhỏ hơn.');
      pages = Array.from({ length: pdf.numPages }, (_, index) => ({ page: index + 1, text: '', textSource: 'pdf_text' as const }));
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        throwIfAborted(options.signal);
        options.onProgress?.({ page: pageNumber, total: pdf.numPages, stage: 'reading', progress: 0 });
        const page = await withIntakeTimeout(pdf.getPage(pageNumber), 20_000, `Không đọc được trang ${pageNumber} trong 20 giây.`);
        try {
          const content = await withIntakeTimeout(page.getTextContent(), 20_000, `Không trích xuất được trang ${pageNumber} trong 20 giây.`);
          const text = reconstructPdfText(content.items, { viewportTransform: page.getViewport({ scale: 1 }).transform });
          pages[pageNumber - 1] = { page: pageNumber, text, textSource: 'pdf_text' };
          if (text.replace(/\s/g, '').length < 60) {
            const unscaled = page.getViewport({ scale: 1 });
            const scale = Math.min(3, 2600 / Math.max(unscaled.width, unscaled.height));
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            try {
              const render = page.render({ canvas, viewport });
              await withIntakeTimeout(render.promise, 30_000, 'Không hiển thị được trang để OCR.').catch(error => { render.cancel(); throw error; });
              pages[pageNumber - 1] = await ocr.recognize(canvas, pageNumber, pdf.numPages);
            } finally { canvas.width = 0; canvas.height = 0; }
          }
        } finally { page.cleanup(); }
      }
      if (pages.reduce((sum, p) => sum + p.text.length, 0) > 300_000) throw new Error('Tài liệu quá dài; giới hạn 300.000 ký tự mỗi tệp.');
      const emptyPages = pages.filter(p => p.text.trim().length < 12 || p.textSource === 'ocr' && (p.ocrConfidence || 0) < .6);
      if (emptyPages.length) return { pages, extractionStatus: 'needs_transcription', extractionError: `Cần kiểm tra / chép lại trang ${emptyPages.map(p => p.page).join(', ')}. OCR chưa đọc đủ rõ.` };
      return { pages, extractionStatus: 'extracted' };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const message = error instanceof Error ? error.message : 'Không đọc được PDF.';
      if (message.includes('50 trang') || message.includes('300.000')) throw error;
      return { pages, extractionStatus: 'needs_transcription', extractionError: `Không trích xuất được văn bản: ${message}. Có thể chép lại nội dung để tiếp tục.` };
    } finally {
      await ocr.close();
      const cleanup = pdf ? pdf.destroy() : loadingTask?.destroy();
      if (cleanup) await withIntakeTimeout(cleanup, 2_000, 'PDF worker cleanup timed out.').catch(() => undefined);
    }
  }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension || '')) {
    const ocr = createLocalOcr(options); const canvas = document.createElement('canvas');
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await withIntakeTimeout(createImageBitmap(file), 20_000, 'Không đọc được ảnh.');
      const scale = Math.min(1, 2600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.ceil(bitmap.width * scale); canvas.height = Math.ceil(bitmap.height * scale);
      const context = canvas.getContext('2d'); if (!context) throw new Error('Không đọc được ảnh.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const page = await ocr.recognize(canvas, 1, 1);
      return { pages: [page], extractionStatus: page.text.trim().length >= 12 && page.ocrConfidence >= .6 ? 'extracted' : 'needs_transcription', extractionError: page.ocrConfidence < .6 ? 'OCR chưa đọc đủ rõ. Kiểm tra bản gốc và chép lại nội dung.' : undefined };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return { pages: [{ page: 1, text: '' }], extractionStatus: 'needs_transcription', extractionError: error instanceof Error ? error.message : 'Không đọc được ảnh.' };
    } finally { bitmap?.close(); canvas.width = 0; canvas.height = 0; await ocr.close(); }
  }
  throw new Error('Chưa hỗ trợ định dạng này. Chọn PDF, TXT, CSV, EML, PNG hoặc JPG.');
}
