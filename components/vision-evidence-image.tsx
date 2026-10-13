"use client";

import { useLocale } from "@/lib/i18n";
import type { Candidate } from "@/lib/types";

/** Show the same authenticated page image used by Kimi, with its proposed reading region. */
export function VisionEvidenceImage({ documentId, page, evidence }: {
  documentId: string;
  page: number;
  evidence: NonNullable<Candidate["visualEvidence"]>;
}) {
  const { locale } = useLocale();
  const [x, y, width, height] = evidence.bounds;
  const params = new URLSearchParams({ documentId, page: String(page), imageSha256: evidence.imageSha256 });
  return <figure style={{ margin: "12px 0" }}>
    <figcaption className="text-amber" style={{ fontSize: 12, marginBottom: 8 }}>
      {locale === "vi"
        ? evidence.textAgreement ? "AI đọc vùng ảnh này; nội dung khớp văn bản nguồn." : "AI đọc vùng ảnh này; nội dung chưa khớp văn bản PDF/OCR. Cần kiểm tra bản gốc."
        : evidence.textAgreement ? "AI read this image region; its text matches the source text." : "AI read this image region; the reading is not corroborated by PDF/OCR text. Check the original."}
    </figcaption>
    <div style={{ position: "relative", width: "100%", lineHeight: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- The private endpoint requires the browser's session cookie. */}
      <img src={`/api/ai/vision-page?${params}`} alt={locale === "vi" ? `Trang nguồn ${page}` : `Source page ${page}`} style={{ width: "100%", height: "auto" }} />
      <span aria-hidden="true" style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`, border: "2px solid #d97706", background: "rgba(245, 158, 11, 0.10)", pointerEvents: "none", boxSizing: "border-box" }} />
    </div>
  </figure>;
}
