import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconstructPdfLayout, reconstructPdfText, type PositionedPdfText } from '../lib/pdf-text.ts';

function item(str: string, x: number, y: number, width = str.length * 5, extras: Partial<PositionedPdfText> = {}): PositionedPdfText {
  return { str, transform: [10, 0, 0, 10, x, y], width, height: 10, ...extras };
}
test('PDF table text follows visual rows and retains columns despite drawing order', () => {
  const layout = reconstructPdfLayout([
    item('12.00', 300, 680), item('Amount', 300, 700), item('2', 220, 680),
    item('Synthetic bolts', 40, 680), item('Description', 40, 700), item('Quantity', 220, 700),
  ]);
  assert.equal(layout.text, 'Description\tQuantity\tAmount\nSynthetic bolts\t2\t12.00');
  assert.equal(layout.lines[1].cells[2].x, 300);
  assert.equal(layout.lines[1].cells[0].y, -690);
});
test('split glyphs are stitched, normal word gaps stay spaces, and baseline jitter stays on one line', () => {
  assert.equal(reconstructPdfText([
    item('voice', 50, 700.4, 25), item('In', 40, 700, 10), item('Number:', 78, 700, 35), item('DEMO-001', 116, 699.7, 40),
  ]), 'Invoice Number: DEMO-001');
});
test('explicit spaces are retained while redundant overprint text is removed', () => {
  const glyph = item('DEMO', 40, 700, 20);
  assert.equal(reconstructPdfText([glyph, { ...glyph }, item(' ', 60, 700, 3), item('INVOICE', 63, 700, 35)]), 'DEMO INVOICE');
});
test('page viewport transforms determine reading order for rotated pages', () => {
  const rotated = [item('Second', 50, 10), item('First', 30, 10)];
  // After the clockwise transform, PDF x becomes screen y and PDF y becomes screen x.
  assert.equal(reconstructPdfText(rotated, { viewportTransform: [0, 1, 1, 0, 0, 0] }), 'First\nSecond');
});
test('markers, empty pages, and malformed positions cannot create spurious evidence', () => {
  assert.equal(reconstructPdfText([{ type: 'beginMarkedContent' }, item('', 0, 0), { str: 'bad', transform: [1, 0, 0, 1, NaN, 0] }]), '');
  assert.equal(reconstructPdfText([]), '');
});
