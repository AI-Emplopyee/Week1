import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FIELD_DEFINITIONS } from '../lib/engine.ts';
import type { GoodsLine } from '../lib/types.ts';
import { VNACCS_FIELDS, VNACCS_REGISTRY, VNACCS_SOURCES, getVnaccsField, getVnaccsCoverageSummary } from '../lib/vnaccs.ts';
import { DECLARATION_CATALOG } from '../lib/declaration-catalog.ts';
import { buildVnaccsCoverageExport, renderVnaccsCoverageCsv, VNACCS_CSV_COLUMNS } from '../lib/vnaccs-export.ts';

const verification = 'source_read_human_confirmation_required';
const expectedAmendments = ['1.12', '1.13', '1.19', '1.20', '1.24', '1.38', '1.44', '1.50', '1.68', '1.69', '1.74', '1.78', '1.80'];
const expectedSystem = ['1.1', '1.70', '1.71', '1.72', '1.73'];

test('reference inventory contains exactly all Form 01 indicators and separates system-owned general fields', () => {
  assert.deepEqual(VNACCS_FIELDS.map(f => f.id), Array.from({ length: 96 }, (_, i) => `1.${i + 1}`));
  assert.deepEqual(VNACCS_FIELDS.map(f => f.ordinal), Array.from({ length: 96 }, (_, i) => i + 1));
  assert.equal(VNACCS_FIELDS.filter(f => f.scope === 'header').length, 68);
  assert.deepEqual(VNACCS_FIELDS.filter(f => f.scope === 'item').map(f => f.id), Array.from({ length: 23 }, (_, i) => `1.${i + 74}`));
  assert.deepEqual(VNACCS_FIELDS.filter(f => f.scope === 'system').map(f => f.id), expectedSystem);
  assert.equal(VNACCS_REGISTRY.generalCount, 73);
  assert.equal(VNACCS_REGISTRY.itemCount, 23);
  assert.equal(getVnaccsField('2.1'), undefined);
});

test('source provenance anchors every row and exactly the 13 verified TT121 Form 01 replacements', () => {
  const sources = new Set<string>(VNACCS_SOURCES.map(s => s.id));
  assert.deepEqual(VNACCS_FIELDS.filter(f => f.amendmentInstructionsVi).map(f => f.id), expectedAmendments);
  assert.deepEqual(VNACCS_REGISTRY.amendedFieldIds, expectedAmendments);
  for (const field of VNACCS_FIELDS) {
    const { baseline, amendments } = field.provenance;
    assert.ok(sources.has(baseline.sourceId), field.id);
    assert.equal(baseline.effectiveFrom, '2018-06-05');
    assert.ok(baseline.pages.length > 0 && baseline.pages.every(p => Number.isInteger(p) && p >= 139 && p <= 168));
    assert.ok(field.sourceInstructionsVi.length > 20, field.id);
    assert.equal(amendments.length, expectedAmendments.includes(field.id) ? 1 : 0);
    for (const amendment of amendments) {
      assert.ok(sources.has(amendment.sourceId));
      assert.equal(amendment.effectiveFrom, '2026-02-01');
      assert.ok(amendment.pages?.length && amendment.pages.every(p => p >= 133 && p <= 145));
      assert.ok(field.amendmentInstructionsVi && field.amendmentInstructionsVi.length > 70);
    }
  }
  // These pages disambiguate text continuing across a page and incidental mentions of another indicator.
  assert.deepEqual(getVnaccsField('1.19')!.provenance.amendments[0].pages, [133, 134]);
  assert.deepEqual(getVnaccsField('1.50')!.provenance.amendments[0].pages, [140]);
  assert.deepEqual(getVnaccsField('1.80')!.provenance.amendments[0].pages, [145]);
});

test('bilingual interpretation is explicitly unverified and does not misread the code-table marker as mandatory', () => {
  const owners = new Set(['customs_system', 'party_master_owner', 'valuation_reviewer', 'classification_origin_reviewer', 'tax_reviewer', 'qualified_customs_reviewer']);
  for (const field of VNACCS_FIELDS) {
    assert.ok(field.labelVi.trim() && field.labelEn.trim(), field.id);
    assert.ok(field.requirement.summaryVi && field.requirement.summaryEn);
    assert.equal(field.requirement.verification, verification);
    assert.ok(field.conditions.length > 0 && field.validation.length > 0);
    for (const note of [...field.conditions, ...field.validation]) {
      assert.ok(note.vi.length > 20 && note.en.length > 20, field.id);
      assert.equal(note.verification, verification);
    }
    assert.ok(owners.has(field.reviewOwner), field.id);
    assert.equal(field.codeTable.status, field.codeTable.referenced ? 'not_loaded' : 'not_applicable');
  }
  // All three have X in the baseline code-table column, but applicability is conditional.
  for (const id of ['1.38', '1.92', '1.95']) {
    assert.equal(getVnaccsField(id)!.codeTable.referenced, true);
    assert.equal(getVnaccsField(id)!.requirement.kind, 'conditional');
  }
  assert.match(VNACCS_REGISTRY.englishLabelStatus, /explanatory translation/);
});

test('every implementation relationship uses a real AICD header or goods field', () => {
  const headers = new Set(FIELD_DEFINITIONS.map(f => f.key));
  const goodsFields = ['id', 'description', 'quantity', 'unit', 'unitPrice', 'amount', 'hsCode', 'origin', 'dutyRate', 'vatRate', 'sourceDocumentId', 'sourcePage', 'originalText', 'reviewed', 'manual', 'reason'] satisfies (keyof GoodsLine)[];
  const goods = new Set<string>(goodsFields.map(f => `goods.${f}`));
  for (const field of VNACCS_FIELDS) {
    for (const key of field.coverage.aicdKeys) assert.ok(headers.has(key) || goods.has(key), `${field.id}: ${key}`);
    if (field.coverage.status === 'not_implemented' || field.coverage.status === 'system_owned') assert.deepEqual(field.coverage.aicdKeys, []);
    else assert.ok(field.coverage.aicdKeys.length > 0, field.id);
  }
  assert.deepEqual(getVnaccsCoverageSummary(), { total: 96, source_proposal: 15, manual_review: 4, not_implemented: 72, system_owned: 5, verifiedEcusMappings: 0, activeLegalRules: 0, currentLawConfirmed: false });
});

test('customs decisions and system data never become automatic source proposals', () => {
  const sensitive = new Set(['customsProcedure', 'countryOfOrigin', 'goods.hsCode', 'goods.origin', 'goods.dutyRate', 'goods.vatRate']);
  for (const field of VNACCS_FIELDS.filter(f => f.coverage.status === 'source_proposal')) {
    assert.ok(field.coverage.aicdKeys.every(key => !sensitive.has(key)), field.id);
  }
  assert.deepEqual(VNACCS_FIELDS.filter(f => f.coverage.status === 'manual_review').map(f => f.id), ['1.4', '1.74', '1.76', '1.79']);
  for (const id of expectedSystem) {
    const field = getVnaccsField(id)!;
    assert.equal(field.requirement.kind, 'system_owned');
    assert.equal(field.reviewOwner, 'customs_system');
    assert.equal(field.coverage.status, 'system_owned');
    assert.deepEqual(field.coverage.aicdKeys, []);
  }
  assert.deepEqual(getVnaccsField('1.79')!.coverage.aicdKeys, ['goods.origin']);
});

test('similar-looking commercial fields are not speculative customs mappings', () => {
  for (const id of ['1.35', '1.50', '1.69', '1.75', '1.84', '1.87', '1.94']) {
    assert.equal(getVnaccsField(id)!.coverage.status, 'not_implemented', id);
    assert.deepEqual(getVnaccsField(id)!.coverage.aicdKeys, []);
  }
  assert.deepEqual(getVnaccsField('1.26')!.coverage.aicdKeys, ['billOfLading', 'houseBillOfLading', 'masterBillOfLading']);
  assert.match(getVnaccsField('1.26')!.coverage.noteEn, /does not choose/);
  assert.deepEqual(getVnaccsField('1.44')!.coverage.aicdKeys, ['invoiceTotal', 'currency', 'incoterm']);
  assert.match(getVnaccsField('1.44')!.coverage.noteEn, /price category.*missing/);
});

test('verified replacement text retains material changes without activating old allowed-value tables', () => {
  assert.match(getVnaccsField('1.44')!.amendmentInstructionsVi!, /DPU/);
  assert.match(getVnaccsField('1.74')!.amendmentInstructionsVi!, /phần mềm/);
  assert.match(getVnaccsField('1.78')!.amendmentInstructionsVi!, /nhà sản xuất/);
  assert.match(getVnaccsField('1.80')!.amendmentInstructionsVi!, /Bảng mã Biểu thuế nhập khẩu/);
  assert.match(getVnaccsField('1.80')!.amendmentInstructionsVi!, /B02[\s\S]*B17/);
  assert.match(getVnaccsField('1.38')!.amendmentInstructionsVi!, /QPGP 06GP17032025/);
  assert.doesNotMatch(getVnaccsField('1.38')!.amendmentInstructionsVi!, /06GP1703202506GP17032025/);
  assert.equal(VNACCS_REGISTRY.activeLegalRuleCount, 0);
  assert.equal(VNACCS_REGISTRY.currentLawConfirmed, false);
  for (const field of VNACCS_FIELDS) {
    assert.equal(field.provenance.currentLawConfirmed, false);
    assert.equal(field.ecusMapping.status, 'unverified');
    assert.equal(field.ecusMapping.target, null);
    assert.notEqual(field.codeTable.status as string, 'active');
  }
  for (const id of ['1.39', '1.40']) assert.match(getVnaccsField(id)!.conditions[0].en, /later.*guidance/i);
});

test('exported JSON and CSV review matrices stay aligned with runtime reference data', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../docs/vnaccs-coverage.json', import.meta.url), 'utf8'));
  assert.deepEqual(snapshot, buildVnaccsCoverageExport());
  const csv = readFileSync(new URL('../docs/vnaccs-coverage.csv', import.meta.url), 'utf8');
  assert.equal(csv, renderVnaccsCoverageCsv());
  // Compact CSV intentionally has no embedded line breaks. Its values are all quoted, including escaped quotes.
  const rows = csv.trim().split(/\r?\n/).map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')));
  assert.equal(rows.length, 97);
  assert.equal(rows[0][0], 'id');
  assert.deepEqual(rows[0], VNACCS_CSV_COLUMNS);
  for (const [i, row] of rows.slice(1).entries()) {
    assert.equal(row.length, rows[0].length);
    assert.equal(row[0], VNACCS_FIELDS[i].id);
    assert.equal(row[1], VNACCS_FIELDS[i].labelVi);
    assert.equal(row[12], VNACCS_FIELDS[i].coverage.status);
    assert.equal(row[16], 'unverified');
    assert.equal(row[17], '');
    assert.equal(row[25], 'false');
    assert.equal(row[26], 'source_fact_relationship');
    assert.equal(row[27], snapshot.fields[i].capture.status);
    assert.equal(row[29], String(DECLARATION_CATALOG[i].editable));
    assert.equal(row[37], 'false');
    assert.equal(row[38], 'false');
    assert.equal(row[39], 'false');
  }
});

test('capture exports distinguish editable structures from source-extraction gaps and legal/vendor verification', () => {
  const snapshot = buildVnaccsCoverageExport();
  assert.deepEqual(snapshot.summary, getVnaccsCoverageSummary());
  assert.match(snapshot.summaryDimension.noteEn, /not missing structured capture/);
  assert.deepEqual(snapshot.captureSummary, { schemaVersion:1,total:96,editable:90,partial:1,customsOwnedReadOnly:5,deferred:1,sourceGapEditable:71,currentLawVerified:0,currentCodeTablesVerified:0,ecusMapped:0 });
  for (const field of snapshot.fields) {
    const catalog = DECLARATION_CATALOG.find(entry=>entry.id===field.id)!;
    assert.equal(field.capture.editable,catalog.editable);
    assert.deepEqual(field.capture.components,catalog.components);
    assert.equal(field.capture.structuralChecks,'software_integrity_only');
    assert.equal(field.capture.currentLawVerified,false);
    assert.equal(field.capture.currentCodeTablesVerified,false);
    assert.equal(field.capture.ecusMappingVerified,false);
    if (field.coverage.status==='not_implemented') {
      assert.match(field.coverage.noteEn,/source-extraction relationship/);
      assert.doesNotMatch(field.coverage.noteEn,/no dedicated field|structure is absent|groups are absent|pair is absent/);
    }
  }
  assert.equal(snapshot.fields.find(field=>field.id==='1.46')!.capture.status,'deferred');
  assert.equal(snapshot.fields.find(field=>field.id==='1.48')!.capture.status,'partial');
  assert.deepEqual(snapshot.fields.filter(field=>field.capture.status==='customs_owned').map(field=>field.id),expectedSystem);
});
