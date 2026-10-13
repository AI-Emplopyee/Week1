import { VNACCS_REFERENCE_DATA } from './vnaccs-data.ts';

export type VnaccsVerification = 'source_read_human_confirmation_required';
export type VnaccsNote = { vi: string; en: string; verification: VnaccsVerification };
export type VnaccsField = {
  id: string; ordinal: number; labelVi: string; labelEn: string;
  scope: 'header' | 'item' | 'system';
  sourceKind: ('document' | 'master_data' | 'customs_system' | 'reviewer_decision')[];
  requirement: { kind: 'required' | 'conditional' | 'system_owned'; summaryVi: string; summaryEn: string; verification: VnaccsVerification };
  conditions: VnaccsNote[]; validation: VnaccsNote[]; reviewOwner: string;
  coverage: { status: 'source_proposal' | 'manual_review' | 'not_implemented' | 'system_owned'; aicdKeys: string[]; noteVi: string; noteEn: string };
  ecusMapping: { status: 'unverified'; target: null; noteVi: string; noteEn: string };
  provenance: { baseline: { sourceId: string; pages: number[]; section: string; effectiveFrom: string }; amendments: { sourceId: string; section: string; effectiveFrom: string; pages?: number[] }[]; currentLawConfirmed: false };
  codeTable: { referenced: boolean; status: 'not_loaded' | 'not_applicable' };
  sourceInstructionsVi: string; amendmentInstructionsVi?: string;
};

export const VNACCS_SOURCES = [
  { id: 'tt39-2018-form01', title: '39/2018/TT-BTC · Phụ lục I · Mẫu số 01 (sửa Phụ lục II TT38)', url: 'https://vntr.moit.gov.vn/storage/doc/file/1629725278%20_%2039.2018.TT-BTC.pdf#page=139', effectiveFrom: '2018-06-05', verifiedAs: 'Official MOIT-hosted PDF, physical pages 139–168; baseline labels and instructions read. Line wrapping normalized for reference transcription.' },
  { id: 'tt39-2018-register', title: '39/2018/TT-BTC · Government document register', url: 'https://vanban.chinhphu.vn/default.aspx?docid=193970&pageid=27160', effectiveFrom: '2018-06-05', verifiedAs: 'Official register confirms issue date 2018-04-20 and effective date 2018-06-05; not a consolidated current-law statement.' },
  { id: 'tt121-2025-register', title: '121/2025/TT-BTC · Government document register', url: 'https://vanban.chinhphu.vn/?docid=216623&pageid=27160', effectiveFrom: '2026-02-01', verifiedAs: 'Official register confirms issue date 2025-12-18 and effective date 2026-02-01.' },
  { id: 'tt121-2025-gazette', title: '121/2025/TT-BTC · Công báo số 60 · Phụ lục I, mục 2(a)', url: 'https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/29/cong-bao-so-60-ngay-27-01-46958signed-1769648620477270334287.pdf#page=133', effectiveFrom: '2026-02-01', verifiedAs: 'Official Gazette PDF and its official DOCX attachment read; 13 Form 01 amendments on physical pages 133–145. Permit-example drawing text transcribed against PDF page 136; repeated paragraph in 1.78 retained as printed.' },
  { id: 'tt121-2025-customs', title: '121/2025/TT-BTC · Customs official copy', url: 'https://files.customs.gov.vn/CustomsCMS/DONG_NAI/2025/12/26/121_2025_TT_BTC_18_12_2025.pdf', effectiveFrom: '2026-02-01', verifiedAs: 'Official scanned copy located; searchable Gazette copy used for field-level transcription.' },
  { id: 'customs-code-table-index', title: 'VNACCS Customs code-table index', url: 'https://www.customs.gov.vn/index.jsp?pageId=26&cid=1192', verifiedAs: 'Official index located; no complete current versioned code-table dataset retrieved or activated on 2026-10-10.' },
  { id: 'chq-gsql-14828-2026', title: '14828/CHQ-GSQL · 03/04/2026 · later implementation guidance', url: 'https://files.customs.gov.vn/CustomsCMS/DONG_NAI/2026/4/3/14828_CHQ_GSQL_03_04_2026.pdf', verifiedAs: 'Later official guidance exists; not a complete consolidated field specification or current code-table release.' },
] as const;

export const VNACCS_REGISTRY = {
  version: 'form01-2018-plus-121-2025-reference.2026-10-10.v1', checkedAt: '2026-10-10', baselineCount: 96, generalCount: 73, itemCount: 23,
  scopeVi: 'Ma trận tham chiếu 96 chỉ tiêu Mẫu 01: nền 2018 và 13 sửa đổi tại TT121/2025. Không phải bộ quy tắc khai báo hiện hành đã xác minh.',
  scopeEn: 'Reference matrix for 96 Form 01 indicators: the 2018 baseline and 13 amendments in Circular 121/2025. This is not a verified current filing rule set.',
  activeLegalRuleCount: 0, currentLawConfirmed: false, englishLabelStatus: 'AICD explanatory translation; Vietnamese source is authoritative',
  amendedFieldIds: ['1.12', '1.13', '1.19', '1.20', '1.24', '1.38', '1.44', '1.50', '1.68', '1.69', '1.74', '1.78', '1.80'],
  sourceIds: VNACCS_SOURCES.map(source => source.id),
  caveatsVi: ['96 là số chỉ tiêu đánh số, không phải 96 ô đơn: nhiều chỉ tiêu chứa nhiều ô con hoặc nhóm lặp.', 'Dấu X trong cột Bảng mã là tham chiếu bảng mã, không phải dấu bắt buộc.', 'Các mức bắt buộc/điều kiện là phân loại tham chiếu để người có chuyên môn xác nhận; không được thực thi như luật.', 'Chưa nạp bảng mã hiện hành; chưa đối chiếu đầy đủ hướng dẫn sau TT121/2025.', 'Đề xuất/nhập tay trong AICD chỉ bao phủ một phần ý nghĩa của chỉ tiêu; mọi ánh xạ ECUS đều chưa xác minh.', 'HS, xuất xứ, trị giá, thuế và việc đăng ký/truyền tờ khai vẫn do người có chuyên môn quyết định.'],
  caveatsEn: ['96 counts numbered indicators, not 96 scalar inputs: several contain subfields or repeated groups.', 'An X in the Code table column references a code table; it is not a mandatory-field marker.', 'Required/conditional classifications are reference interpretations for qualified confirmation, not executable law.', 'Current code tables are not loaded; guidance after Circular 121/2025 has not been comprehensively reconciled.', 'An AICD proposal or manual field covers only part of an indicator; every ECUS mapping is unverified.', 'HS, origin, valuation, taxes and declaration filing remain qualified human decisions.'],
} as const;

export const VNACCS_FIELDS: readonly VnaccsField[] = VNACCS_REFERENCE_DATA;
export function getVnaccsField(id: string): VnaccsField | undefined { return VNACCS_FIELDS.find(field => field.id === id); }
/** Counts implementation relationships, never declaration completeness or legal readiness. */
export function getVnaccsCoverageSummary() {
  const count = (status: VnaccsField['coverage']['status']) => VNACCS_FIELDS.filter(field => field.coverage.status === status).length;
  return { total: VNACCS_FIELDS.length, source_proposal: count('source_proposal'), manual_review: count('manual_review'), not_implemented: count('not_implemented'), system_owned: count('system_owned'), verifiedEcusMappings: 0, activeLegalRules: 0, currentLawConfirmed: false as const };
}
