import type { Worker, RecognizeResult } from 'tesseract.js';
import { reconstructOcrText, ocrQuality } from './ocr-layout.ts';

export type IntakeProgress = { page: number; total: number; stage: 'reading' | 'ocr'; progress: number };
export type IntakeOptions = { onProgress?: (progress: IntakeProgress) => void; signal?: AbortSignal };

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Đã hủy tiếp nhận.', 'AbortError');
}

/** One disposable worker per upload, with all assets served from the app's own origin. */
export function createLocalOcr(options: IntakeOptions) {
  let worker: Worker | undefined;
  let pending: Promise<Worker> | undefined;
  let disposed = false;
  let active = { page: 1, total: 1 };
  const dispose = async () => { disposed = true; await worker?.terminate().catch(() => undefined); worker = undefined; };
  const abort = () => { void dispose(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  async function bounded<T>(operation: Promise<T>, milliseconds = 90_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    try {
      throwIfAborted(options.signal);
      return await Promise.race([operation, new Promise<T>((_, reject) => {
        timer = setTimeout(() => { void dispose(); reject(new Error('OCR quá thời gian xử lý. Kiểm tra bản gốc và chép lại trang chưa đọc được.')); }, milliseconds);
        abortHandler = () => reject(new DOMException('Đã hủy tiếp nhận.', 'AbortError'));
        options.signal?.addEventListener('abort', abortHandler, { once: true });
      })]);
    } finally { if (timer) clearTimeout(timer); if (abortHandler) options.signal?.removeEventListener('abort', abortHandler); }
  }
  async function getWorker() {
    if (disposed) throw new Error('OCR đã dừng. Kiểm tra bản gốc và chép lại trang chưa đọc được.');
    if (!pending) pending = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const origin = window.location.origin;
      const created = await createWorker(['eng', 'vie'], 1, {
        workerPath: `${origin}/ocr/worker.min.js`, corePath: `${origin}/ocr/core`,
        langPath: `${origin}/ocr/lang`, workerBlobURL: false,
        logger: message => options.onProgress?.({ ...active, stage: 'ocr', progress: Number.isFinite(message.progress) ? message.progress : 0 }),
      });
      if (disposed) { await created.terminate(); throw new Error('OCR đã dừng.'); }
      worker = created;
      await created.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
      return created;
    })();
    return bounded(pending, 60_000);
  }
  return {
    async recognize(canvas: HTMLCanvasElement, page: number, total: number) {
      active = { page, total }; throwIfAborted(options.signal);
      const instance = await getWorker();
      const run = async (angle: number) => {
        if (!angle) return bounded(instance.recognize(canvas, { rotateAuto: true }, { text: true, blocks: true }));
        // Rotate the raster into a correctly sized surface: engine-only quarter turns can crop portrait pages.
        const rotated = document.createElement('canvas');
        const quarterTurn = Math.abs(angle) === Math.PI / 2;
        rotated.width = quarterTurn ? canvas.height : canvas.width;
        rotated.height = quarterTurn ? canvas.width : canvas.height;
        const context = rotated.getContext('2d');
        if (!context) throw new Error('Không đọc được ảnh.');
        context.translate(rotated.width / 2, rotated.height / 2); context.rotate(angle);
        context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        try { return await bounded(instance.recognize(rotated, { rotateAuto: true }, { text: true, blocks: true })); }
        finally { rotated.width = 0; rotated.height = 0; }
      };
      let result: RecognizeResult = await run(0);
      // Try quarter turns only for weak readings. Original evidence is preserved unchanged.
      if (result.data.confidence < 72 || (result.data.text.match(/\w{2,}/g)?.length || 0) < 8) {
        for (const angle of [-Math.PI / 2, Math.PI / 2, Math.PI]) {
          throwIfAborted(options.signal);
          const alternate = await run(angle);
          if (ocrQuality(alternate.data) > ocrQuality(result.data)) result = alternate;
          if (result.data.confidence >= 78 && result.data.text.trim().length > 100) break;
        }
      }
      return { page, text: reconstructOcrText(result.data), textSource: 'ocr' as const, ocrConfidence: Math.max(0, Math.min(1, (result.data.confidence || 0) / 100)) };
    },
    async close() { options.signal?.removeEventListener('abort', abort); await dispose(); },
  };
}
