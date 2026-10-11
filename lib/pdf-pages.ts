import { PDFDocument } from 'pdf-lib';
import type { SourcePage } from './types';

/** The physical PDF determines page boundaries; browser text cannot omit blank pages. */
export async function boundedPdfPages(bytes: Uint8Array, supplied: SourcePage[] = []): Promise<SourcePage[]> {
  let count: number;
  try { count = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount(); }
  catch { return []; } // Preserve encrypted or damaged originals, with transcription required.
  if (count > 50) throw new Error('PDF documents are limited to 50 pages. Split this document before intake.');
  if (supplied.some(page => page.page > count)) throw new Error('Extracted text refers to a page outside this PDF.');
  return Array.from({ length: count }, (_, index) => {
    const extracted = supplied.find(page => page.page === index + 1);
    return extracted ? { ...extracted, page: index + 1 } : { page: index + 1, text: '' };
  });
}
