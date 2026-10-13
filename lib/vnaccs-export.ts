import { DECLARATION_CATALOG } from './declaration-catalog.ts';
import { VNACCS_FIELDS, VNACCS_REGISTRY, VNACCS_SOURCES, getVnaccsCoverageSummary } from './vnaccs.ts';

/** Join the separate reference and capture models here, avoiding a registry/catalog import cycle. */
export function buildVnaccsCoverageExport() {
  const fields = VNACCS_FIELDS.map(field => {
    const capture = DECLARATION_CATALOG.find(entry => entry.id === field.id);
    if (!capture) throw new Error(`Missing declaration catalog indicator ${field.id}.`);
    return {
      ...field,
      capture: {
        schemaVersion: 1,
        status: capture.editable ? (capture.blockedComponents.length ? 'partial' : 'editable') : (capture.scope === 'system' ? 'customs_owned' : 'deferred'),
        editable: capture.editable,
        kind: capture.kind,
        repeatable: capture.repeatable,
        scope: capture.scope,
        tab: capture.tab,
        section: capture.section,
        components: capture.components,
        blockedComponents: capture.blockedComponents,
        blockedReasonVi: capture.blockedReasonVi ?? null,
        blockedReasonEn: capture.blockedReasonEn ?? null,
        structuralChecks: 'software_integrity_only',
        currentLawVerified: false,
        currentCodeTablesVerified: false,
        ecusMappingVerified: false,
      },
    };
  });
  return {
    registry: VNACCS_REGISTRY,
    sources: VNACCS_SOURCES,
    summary: getVnaccsCoverageSummary(),
    summaryDimension: {
      id: 'source_fact_relationship',
      noteVi: 'summary và coverage ghi liên kết dữ kiện nguồn ban đầu. not_implemented có nghĩa chưa có liên kết trích xuất nguồn, không phải thiếu khả năng nhập cấu trúc. captureSummary và capture mô tả mô hình nhập riêng; không đánh giá độ đầy đủ của hồ sơ.',
      noteEn: 'summary and coverage describe original source-fact relationships. not_implemented means no source-extraction relationship, not missing structured capture. captureSummary and capture describe the separate editor model; they do not assess case completeness.',
    },
    captureSummary: {
      schemaVersion: 1,
      total: fields.length,
      editable: fields.filter(field => field.capture.editable).length,
      partial: fields.filter(field => field.capture.status === 'partial').length,
      customsOwnedReadOnly: fields.filter(field => field.capture.status === 'customs_owned').length,
      deferred: fields.filter(field => field.capture.status === 'deferred').length,
      sourceGapEditable: fields.filter(field => field.coverage.status === 'not_implemented' && field.capture.editable).length,
      currentLawVerified: 0,
      currentCodeTablesVerified: 0,
      ecusMapped: 0,
    },
    fields,
  };
}

// Keep the original first 26 columns stable for existing review tools; append capture dimensions.
export const VNACCS_CSV_COLUMNS = [
  'id', 'label_vi', 'label_en', 'scope', 'source_kinds', 'requirement', 'requirement_verification',
  'condition_vi', 'condition_en', 'validation_vi', 'validation_en', 'review_owner', 'coverage_status',
  'aicd_keys', 'coverage_note_vi', 'coverage_note_en', 'ecus_mapping_status', 'ecus_target', 'code_table_status',
  'baseline_source', 'baseline_pages', 'baseline_effective_from', 'amendment_source', 'amendment_pages', 'amendment_effective_from', 'current_law_confirmed',
  'coverage_dimension', 'capture_status', 'capture_schema_version', 'capture_editable', 'capture_kind', 'capture_repeatable',
  'capture_components', 'capture_blocked_components', 'capture_blocked_reason_vi', 'capture_blocked_reason_en',
  'capture_structural_checks', 'capture_current_law_verified', 'capture_current_code_tables_verified', 'capture_ecus_mapping_verified',
] as const;

export function renderVnaccsCoverageCsv(snapshot = buildVnaccsCoverageExport()): string {
  const quote = (value: unknown) => `"${String(value ?? '').replace(/\s+/g, ' ').replaceAll('"', '""')}"`;
  const rows = snapshot.fields.map(field => {
    const { baseline, amendments } = field.provenance;
    return [
      field.id, field.labelVi, field.labelEn, field.scope, field.sourceKind.join(';'), field.requirement.kind, field.requirement.verification,
      field.conditions.map(note => note.vi).join(' | '), field.conditions.map(note => note.en).join(' | '),
      field.validation.map(note => note.vi).join(' | '), field.validation.map(note => note.en).join(' | '), field.reviewOwner,
      field.coverage.status, field.coverage.aicdKeys.join(';'), field.coverage.noteVi, field.coverage.noteEn,
      field.ecusMapping.status, field.ecusMapping.target, field.codeTable.status, baseline.sourceId, baseline.pages.join(';'), baseline.effectiveFrom,
      amendments.map(source => source.sourceId).join(';'), amendments.flatMap(source => source.pages ?? []).join(';'), amendments.map(source => source.effectiveFrom).join(';'), field.provenance.currentLawConfirmed,
      snapshot.summaryDimension.id, field.capture.status, field.capture.schemaVersion, field.capture.editable, field.capture.kind, field.capture.repeatable,
      JSON.stringify(field.capture.components), JSON.stringify(field.capture.blockedComponents), field.capture.blockedReasonVi, field.capture.blockedReasonEn,
      field.capture.structuralChecks, field.capture.currentLawVerified, field.capture.currentCodeTablesVerified, field.capture.ecusMappingVerified,
    ];
  });
  return [VNACCS_CSV_COLUMNS, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
