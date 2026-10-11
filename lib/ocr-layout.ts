import { reconstructPdfText } from './pdf-text.ts';

type OcrWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
type OcrLine = { words: OcrWord[]; bbox: { y1: number } };
type OcrPage = { text: string; blocks: { paragraphs: { lines: OcrLine[] }[] }[] | null; confidence: number };

/** Use each OCR line's common baseline; word bottoms vary for descenders and punctuation. */
export function reconstructOcrText(data: OcrPage): string {
  const items = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words.map(word => ({
    str: word.text, transform: [1, 0, 0, 1, word.bbox.x0, line.bbox.y1],
    width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0,
  })))));
  return items.length ? reconstructPdfText(items, { viewportTransform: [1, 0, 0, 1, 0, 0] }) : data.text;
}

export function ocrQuality(data: Pick<OcrPage, 'text' | 'confidence'>): number {
  const words = data.text.match(/[\p{L}\p{N}]{2,}/gu)?.length || 0;
  return Math.max(0, Math.min(100, data.confidence || 0)) * Math.log1p(Math.min(words, 100));
}
