import type { PDFiumDocument } from '@hyzyla/pdfium';

export type PdfRaster = { width: number; height: number; data: Uint8Array };

/** Raster pixels only. No text, table, OCR, or document interpretation happens here. */
export async function rasterizePdfPage(document: PDFiumDocument, pageNumber: number, maxDimension = 2600): Promise<PdfRaster> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.getPageCount()) throw new Error('The selected PDF page does not exist.');
  if (!Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > 2600) throw new Error('Invalid PDF rendering size.');
  const page = document.getPage(pageNumber - 1);
  try {
    const { originalWidth, originalHeight } = page.getOriginalSize();
    if (![originalWidth, originalHeight].every(size => Number.isFinite(size) && size > 0)) throw new Error('The PDF page has invalid dimensions.');
    const scale = Math.min(3, maxDimension / Math.max(originalWidth, originalHeight));
    const result = await page.render({ scale, colorSpace: 'RGBA', renderFormFields: true, transparent: false });
    if (result.width < 1 || result.height < 1 || result.width > maxDimension || result.height > maxDimension || result.data.length !== result.width * result.height * 4) throw new Error('The PDF page could not be rendered safely.');
    return { width: result.width, height: result.height, data: result.data };
  } finally { page.close(); }
}
