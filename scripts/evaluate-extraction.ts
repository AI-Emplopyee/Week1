/** Local-only sample regression. Expected values and client source text must remain in ignored directories. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { classifyDocument, derivePageTypes, extractDocument } from '../lib/extraction.ts';
import { applyAction, createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import type { SourcePage, ShipmentDocument } from '../lib/types.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const manifestPath = option('--manifest'); const ocrPath = option('--ocr'); const outputPath = option('--output');
if (!manifestPath || !outputPath) throw new Error('Usage: node --experimental-strip-types scripts/evaluate-extraction.ts --manifest <local inventory.json> --pages-dir <local document-N.json directory> [--ocr <local OCR array.json>] [--expected <local reviewer checks.json>] --output <ignored local result.json>');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { file?: string; name?: string; sourceJson?: string }[];
const pagesDirectory = resolve(option('--pages-dir', dirname(manifestPath))!);
const overrides = ocrPath ? JSON.parse(readFileSync(ocrPath, 'utf8')) as ({ document: number; page: number; text: string; textSource?: 'ocr'; ocrConfidence?: number })[] : [];
const expectedPath = option('--expected');
const checks = expectedPath ? JSON.parse(readFileSync(expectedPath, 'utf8')) as { document: number; page: number; field: string; value: string; lineIndex?: number; note?: string }[] : [];
const preferNative = !args.includes('--prefer-ocr');
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const documents: ShipmentDocument[] = [];
const extraction = manifest.map((entry, index) => {
  const raw = JSON.parse(readFileSync(entry.sourceJson ? resolve(pagesDirectory, entry.sourceJson) : resolve(pagesDirectory, `document-${index + 1}.json`), 'utf8')) as { name: string; pages: SourcePage[] };
  const pages: SourcePage[] = raw.pages.map(page => {
    const override = overrides.find(x => x.document === index + 1 && x.page === page.page);
    return override && (!preferNative || page.text.trim().length < 40)
      ? { page: page.page, text: override.text, textSource: 'ocr', ocrConfidence: override.ocrConfidence }
      : { page: page.page, text: page.text, textSource: 'pdf_text' };
  });
  const document: ShipmentDocument = { id: `local-regression-${index + 1}`, caseId: 'local-regression', name: raw.name, type: classifyDocument(raw.name, pages.map(p => p.text).join('\n')), mime: 'application/pdf', size: 0, sha256: `local-regression-${index + 1}`, pages, version: 1, active: true, uploadedAt: new Date().toISOString(), synthetic: false, extractionStatus: pages.every(p => p.text.trim().length > 0) ? 'extracted' : 'needs_transcription' };
  derivePageTypes(document); documents.push(document);
  return { document: index + 1, name: document.name, pageTypes: document.pages.map(p => ({ page: p.page, documentType: p.documentType, textSource: p.textSource, characters: p.text.length })), ...extractDocument(document) };
});
const comparisons = checks.map(check => {
  const result = extraction[check.document - 1];
  let candidates = result.candidates.filter(c => c.field === check.field && c.page === check.page && (check.lineIndex === undefined ? !c.lineId : !!c.lineId));
  if (check.lineIndex !== undefined) { const line = result.goods.filter(g => g.sourcePage === check.page)[check.lineIndex]; candidates = candidates.filter(c => c.lineId === line?.id); }
  const values = [...new Set(candidates.map(c => c.value))];
  const matched = values.some(v => normalized(v) === normalized(check.value));
  const unexpected = values.filter(v => normalized(v) !== normalized(check.value));
  return { ...check, observedValues: values, matched, missing: !values.length, unexpected, methods: [...new Set(candidates.map(c => c.method))], confidences: [...new Set(candidates.map(c => c.confidence))] };
});
const actor = { id: 'local-evaluator', name: 'Local sample evaluation', email: 'local-evaluator@example.invalid' };
let workspace = applyAction(createEmptyWorkspace('local-regression'), { type: 'create_case', title: 'Local sample evaluation — not a published demo' }, actor);
workspace = applyAction(workspace, { type: 'intake', documents, targetCaseId: workspace.cases[0].id }, actor);
const issues = getIssues(workspace);
const summary = {
  documents: documents.length, pagesInventoried: documents.reduce((n, d) => n + d.pages.length, 0), pagesWithText: documents.flatMap(d => d.pages).filter(p => p.text.trim()).length,
  ocrPages: documents.flatMap(d => d.pages).filter(p => p.textSource === 'ocr').length,
  candidates: extraction.reduce((n, result) => n + result.candidates.length, 0), goodsProposals: extraction.reduce((n, result) => n + result.goods.length, 0),
  visuallyCheckedExpectedValues: checks.length, matches: comparisons.filter(c => c.matched).length, missing: comparisons.filter(c => c.missing).length, checksWithUnexpectedValues: comparisons.filter(c => c.unexpected.length).length,
  openIssues: issues.filter(i => !i.resolved).length, workspaceBytes: Buffer.byteLength(JSON.stringify(workspace)),
  limitations: 'Selected source values only; expected checks are local visual review, not a broker-reviewed declaration. Unchecked values and remaining scan pages have no accuracy measurement. All proposals require review. No customs or ECUS validation.',
};
writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, comparisons, extraction, issues }, null, 2));
console.log(JSON.stringify(summary, null, 2));
