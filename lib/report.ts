import type { WorkspaceState } from './types.ts';
export { buildReport } from './report-data.ts';
import { buildReportContent } from './report-content.ts';
import type { Locale } from './i18n-core.ts';

export async function generateReportPdf(state: WorkspaceState, caseId: string, suppliedFont?: Uint8Array, locale: Locale = 'vi'): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, fontkitModule] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]);
  const content = buildReportContent(state, caseId, locale);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitModule.default);
  const fontResponse = suppliedFont ? null : await fetch('/fonts/NotoSans-Regular.ttf');
  if (fontResponse && !fontResponse.ok) throw new Error(locale === 'en' ? 'Unable to load the report font. Please try again.' : 'Không tải được phông chữ báo cáo. Hãy thử lại.');
  const fontBytes = suppliedFont || new Uint8Array(await fontResponse!.arrayBuffer());
  const font = await pdf.embedFont(fontBytes, { subset: true });
  pdf.setTitle(content.title); pdf.setAuthor('AICD'); pdf.setSubject(content.subject); pdf.setLanguage(locale);
  const width = 595.28, height = 841.89, margin = 44, usable = width - margin * 2;
  const colors = { ink: rgb(.13, .18, .23), muted: rgb(.40, .45, .49), teal: rgb(.04, .40, .35), amber: rgb(.58, .34, .10) };
  let page = pdf.addPage([width, height]); let y = height - margin;
  const clean = (value: unknown) => String(value ?? '—').normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\t/g, '    ');
  const wrap = (value: unknown, size: number, maxWidth = usable) => {
    const lines: string[] = [];
    for (const paragraph of clean(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (font.widthOfTextAtSize(line ? line + ' ' + word : word, size) <= maxWidth) { line += (line ? ' ' : '') + word; continue; }
        if (line) { lines.push(line); line = ''; }
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > maxWidth) { lines.push(line); line = ''; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const newPage = () => { page = pdf.addPage([width, height]); y = height - margin; page.drawText('AICD  /  ' + content.data.shipment.reference, { x: margin, y, font, size: 9, color: colors.muted }); y -= 27; };
  const reserve = (space: number) => { if (y - space < 56) newPage(); };
  const text = (value: unknown, size = 9, color = colors.ink) => {
    const leading = size * 1.55;
    for (const line of wrap(value, size)) { reserve(leading); page.drawText(line, { x: margin, y, font, size, color }); y -= leading; }
  };
  const section = (title: string) => { reserve(75); y -= 14; page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .5, color: rgb(.84, .88, .87) }); y -= 20; text(title, 12, colors.teal); y -= 6; };
  for (const block of content.blocks) {
    if (block.kind === 'page') newPage();
    else if (block.kind === 'gap') y -= block.space;
    else if (block.kind === 'section') section(block.value);
    else { if (block.tone === 'teal') reserve(45); text(block.value, block.size, colors[block.tone]); }
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawLine({ start: { x: margin, y: 39 }, end: { x: width - margin, y: 39 }, thickness: .5, color: rgb(.84, .88, .87) });
    sheet.drawText(content.footer, { x: margin, y: 25, font, size: 7, color: colors.muted });
    sheet.drawText((index + 1) + ' / ' + pages.length, { x: width - margin - 30, y: 25, font, size: 8, color: colors.muted });
  });
  return pdf.save();
}

export async function downloadReport(state: WorkspaceState, caseId: string, locale: Locale = 'vi'): Promise<void> {
  const bytes = await generateReportPdf(state, caseId, undefined, locale);
  const shipment = state.cases.find(item => item.id === caseId)!;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'AICD-' + shipment.reference + '-review-' + locale + '.pdf'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
