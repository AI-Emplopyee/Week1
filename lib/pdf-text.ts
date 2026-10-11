/** Minimal PDF.js text shape, deliberately independent of its browser/worker runtime. */
export type PositionedPdfText = {
  str: string;
  transform: readonly number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
  dir?: string;
};
export type PdfLayoutCell = { text: string; x: number; y: number; width: number; height: number };
export type PdfLayoutLine = { text: string; x: number; y: number; height: number; cells: PdfLayoutCell[] };
export type PdfTextLayout = { text: string; lines: PdfLayoutLine[] };
type Glyph = PdfLayoutCell & { baseline: number; order: number; explicitSpace: boolean };
type Row = { baseline: number; height: number; glyphs: Glyph[] };
type Options = {
  /** PDF.js page.getViewport({scale:1}).transform handles page rotation and PDF's bottom-up y axis. */
  viewportTransform?: readonly number[];
};
const DEFAULT_VIEWPORT = [1, 0, 0, -1, 0, 0];
function isItem(value: unknown): value is PositionedPdfText {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PositionedPdfText>;
  return typeof item.str === 'string' && Array.isArray(item.transform) && item.transform.length >= 6 && item.transform.slice(0, 6).every(Number.isFinite);
}
function median(values: number[], fallback: number): number {
  const sorted = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : fallback;
}
function point(x: number, y: number, matrix: readonly number[]) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

/**
 * Reconstructs visible rows from positions, rather than the PDF drawing-command order.
 * Large horizontal gaps become tabs, retaining invoice/table cell boundaries. Coordinates
 * remain available for callers that need richer layout; no values are inferred or corrected.
 */
export function reconstructPdfLayout(items: readonly unknown[], options: Options = {}): PdfTextLayout {
  const viewport = options.viewportTransform?.length === 6 && options.viewportTransform.every(Number.isFinite) ? options.viewportTransform : DEFAULT_VIEWPORT;
  const scaleX = Math.hypot(viewport[0], viewport[1]) || 1;
  const scaleY = Math.hypot(viewport[2], viewport[3]) || 1;
  const glyphs: Glyph[] = [];
  const seen = new Set<string>();
  for (const [order, value] of items.entries()) {
    if (!isItem(value) || !value.str) continue;
    const origin = point(value.transform[4], value.transform[5], viewport);
    const text = value.str.replace(/[\r\n\t\u00a0]/g, ' ');
    const height = Math.max(1, Math.abs(value.height || Math.hypot(value.transform[2], value.transform[3]) || 10) * scaleY);
    const width = Math.max(0, Math.abs(value.width ?? text.length * height * 0.5) * scaleX);
    // Overprinted copies are common in text layers. Only exact text at the same position is removed.
    const key = `${Math.round(origin.x * 10)}:${Math.round(origin.y * 10)}:${Math.round(width * 10)}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    glyphs.push({ text, x: origin.x, y: origin.y - height, width, height, baseline: origin.y, order, explicitSpace: !text.trim() });
  }
  glyphs.sort((a, b) => a.baseline - b.baseline || a.x - b.x || a.order - b.order);
  const rows: Row[] = [];
  for (const glyph of glyphs) {
    // Small baseline jitter must not split one visible row. A bounded lookback avoids quadratic work.
    let row: Row | undefined;
    let closest = Infinity;
    for (let index = rows.length - 1; index >= Math.max(0, rows.length - 5); index--) {
      const candidate = rows[index];
      const distance = Math.abs(candidate.baseline - glyph.baseline);
      const tolerance = Math.max(1.5, Math.min(4, Math.min(candidate.height, glyph.height) * 0.28));
      if (distance <= tolerance && distance < closest) { row = candidate; closest = distance; }
    }
    if (!row) { row = { baseline: glyph.baseline, height: glyph.height, glyphs: [] }; rows.push(row); }
    const count = row.glyphs.length;
    row.baseline = (row.baseline * count + glyph.baseline) / (count + 1);
    row.height = Math.max(row.height, glyph.height);
    row.glyphs.push(glyph);
  }
  rows.sort((a, b) => a.baseline - b.baseline);
  const lines: PdfLayoutLine[] = [];
  for (const row of rows) {
    row.glyphs.sort((a, b) => a.x - b.x || a.order - b.order);
    const visible = row.glyphs.filter(glyph => !glyph.explicitSpace);
    if (!visible.length) continue;
    const averageCharacter = median(visible.map(glyph => glyph.width / Math.max(1, [...glyph.text].length)), row.height * 0.5);
    const spaceWidth = Math.max(1, Math.min(averageCharacter * 0.65, row.height * 0.4));
    const columnGap = Math.max(row.height * 0.8, spaceWidth * 2.6);
    const cells: PdfLayoutCell[] = [];
    let cell: PdfLayoutCell | undefined;
    let previousEnd = 0;
    let explicitSpace = false;
    for (const glyph of row.glyphs) {
      if (glyph.explicitSpace) { explicitSpace = true; continue; }
      const text = glyph.text.trim();
      const gap = cell ? glyph.x - previousEnd : 0;
      if (!cell || gap >= columnGap) {
        cell = { text, x: glyph.x, y: glyph.y, width: glyph.width, height: glyph.height };
        cells.push(cell);
      } else {
        const separator = explicitSpace || gap > spaceWidth * 0.35 || /\s$/.test(cell.text) || /^\s/.test(glyph.text) ? ' ' : '';
        cell.text = `${cell.text.trimEnd()}${separator}${text}`;
        cell.width = Math.max(cell.width, glyph.x + glyph.width - cell.x);
        cell.height = Math.max(cell.height, glyph.height);
        cell.y = Math.min(cell.y, glyph.y);
      }
      previousEnd = Math.max(previousEnd, glyph.x + glyph.width);
      explicitSpace = /\s$/.test(glyph.text);
    }
    const text = cells.map(cell => cell.text).join('\t');
    lines.push({ text, x: cells[0].x, y: Math.min(...cells.map(cell => cell.y)), height: row.height, cells });
  }
  return { text: lines.map(line => line.text).join('\n'), lines };
}

export function reconstructPdfText(items: readonly unknown[], options: Options = {}): string {
  return reconstructPdfLayout(items, options).text;
}
