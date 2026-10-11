import type { SourcePage } from './types.ts';

export const NO_USABLE_EXTRACTION = 'Chưa có văn bản hoặc kết quả OCR dùng được. Đối chiếu bản gốc và thêm bản chép đã kiểm tra.';

/** Human transcription is explicit evidence review; automatic text must meet the minimum quality gate. */
export function pagesNeedingReview(pages: SourcePage[]): number[] {
  return pages.filter(page => {
    if (page.text.trim().length < (page.textSource === 'manual' ? 1 : 12)) return true;
    return page.textSource === 'ocr' && (!Number.isFinite(page.ocrConfidence) || (page.ocrConfidence ?? 0) < 0.6);
  }).map(page => page.page);
}

export function assessExtraction(pages: SourcePage[], reportedStatus?: string, reportedError?: string): { extractionStatus: 'extracted' | 'needs_transcription'; extractionError?: string } {
  const pendingPages = pagesNeedingReview(pages);
  const reportedIncomplete = reportedStatus !== undefined && reportedStatus !== 'extracted';
  if (pages.length && !pendingPages.length && !reportedIncomplete) return { extractionStatus: 'extracted' };
  const message = !pages.length ? NO_USABLE_EXTRACTION : pendingPages.length
    ? `Trang ${pendingPages.join(', ')} chưa có văn bản đủ rõ hoặc OCR có độ tin cậy thấp. Đối chiếu bản gốc và chép lại các trang này.`
    : 'Trích xuất chưa hoàn tất. Đối chiếu bản gốc và kiểm tra bản chép trước khi phê duyệt.';
  // Preserve useful worker diagnostics without trusting them to clear the server's quality gate.
  const detail = reportedError?.trim().slice(0, 2000);
  return { extractionStatus: 'needs_transcription', extractionError: detail && detail !== message ? `${message}\n${detail}` : message };
}
