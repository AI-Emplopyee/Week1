import type { Action, Actor, AuditEntry, Candidate, DocumentType, FieldDefinition, GoodsLine, Issue, ReviewedValue, ShipmentCase, ShipmentDocument, UploadedDocument, WorkspaceState } from './types.ts';
import { classifyDocument, extractDocument, parseNumber, derivePageTypes, documentHasType, pageDocumentType } from './extraction.ts';
import { simulateTestDraft, successfulRunForSnapshot } from './ecus.ts';
import { syntheticShipments } from './demo.ts';
import { assessExtraction, NO_USABLE_EXTRACTION, pagesNeedingReview } from './extraction-quality.ts';
import { groundKimiProposals, selectKimiPages, KIMI_ENDPOINT } from './kimi.ts';

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  { key: 'importer', label: 'Người nhập khẩu', group: 'Các bên', required: true },
  { key: 'exporter', label: 'Người xuất khẩu', group: 'Các bên', required: true },
  { key: 'invoiceNumber', label: 'Số hóa đơn', group: 'Hóa đơn', required: true },
  { key: 'invoiceDate', label: 'Ngày hóa đơn', group: 'Hóa đơn', required: true },
  { key: 'currency', label: 'Đồng tiền', group: 'Hóa đơn', required: true },
  { key: 'invoiceTotal', label: 'Trị giá hóa đơn', group: 'Hóa đơn', required: true },
  { key: 'incoterm', label: 'Điều kiện giao hàng', group: 'Hóa đơn' },
  { key: 'billOfLading', label: 'Số vận đơn (chưa xác định cấp)', group: 'Vận chuyển' },
  { key: 'houseBillOfLading', label: 'Số vận đơn House (HBL)', group: 'Vận chuyển' },
  { key: 'masterBillOfLading', label: 'Số vận đơn Master (MBL)', group: 'Vận chuyển' },
  { key: 'transportReference', label: 'Số tham chiếu vận chuyển / booking', group: 'Vận chuyển' },
  { key: 'transportShipper', label: 'Shipper ghi trên vận đơn', group: 'Các bên trên vận đơn' },
  { key: 'transportConsignee', label: 'Consignee ghi trên vận đơn', group: 'Các bên trên vận đơn' },
  { key: 'notifyParty', label: 'Notify party ghi trên vận đơn', group: 'Các bên trên vận đơn' },
  { key: 'houseShipper', label: 'Shipper trên HBL', group: 'Các bên trên vận đơn' },
  { key: 'houseConsignee', label: 'Consignee trên HBL', group: 'Các bên trên vận đơn' },
  { key: 'houseNotifyParty', label: 'Notify party trên HBL', group: 'Các bên trên vận đơn' },
  { key: 'masterShipper', label: 'Shipper trên MBL', group: 'Các bên trên vận đơn' },
  { key: 'masterConsignee', label: 'Consignee trên MBL', group: 'Các bên trên vận đơn' },
  { key: 'masterNotifyParty', label: 'Notify party trên MBL', group: 'Các bên trên vận đơn' },
  { key: 'contractNumber', label: 'Số hợp đồng', group: 'Hóa đơn' },
  { key: 'packingListDate', label: 'Ngày phiếu đóng gói', group: 'Đóng gói' },
  { key: 'vessel', label: 'Tên tàu / chuyến bay', group: 'Vận chuyển' },
  { key: 'voyage', label: 'Số chuyến', group: 'Vận chuyển' },
  { key: 'portOfLoading', label: 'Cảng xếp hàng', group: 'Vận chuyển' },
  { key: 'portOfDischarge', label: 'Cảng dỡ hàng', group: 'Vận chuyển' },
  { key: 'container', label: 'Container', group: 'Vận chuyển' },
  { key: 'packageCount', label: 'Số kiện', group: 'Đóng gói' },
  { key: 'grossWeight', label: 'Trọng lượng cả bì (kg)', group: 'Đóng gói' },
  { key: 'netWeight', label: 'Trọng lượng tịnh (kg)', group: 'Đóng gói' },
  { key: 'customsProcedure', label: 'Loại hình — nhập tay, chưa xác minh', group: 'Quyết định hải quan', manualOnly: true },
  { key: 'countryOfOrigin', label: 'Xuất xứ — nhập tay, chưa xác minh', group: 'Quyết định hải quan', manualOnly: true },
];
export const DOCUMENT_LABELS: Record<DocumentType, string> = { invoice: 'Hóa đơn', packing_list: 'Phiếu đóng gói', bill_of_lading: 'Vận đơn đường biển', air_waybill: 'Vận đơn hàng không', contract: 'Hợp đồng', certificate_of_origin: 'Chứng nhận xuất xứ', other: 'Khác / chưa phân loại' };
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const same = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const sameField = (field: string, value: string) => {
  if (['invoiceTotal', 'packageCount', 'grossWeight', 'netWeight', 'quantity', 'unitPrice', 'amount'].includes(field) && /^\d+(?:\.\d+)?$/.test(value.trim())) { const [integer, decimal = ''] = value.trim().split('.'); return `${integer.replace(/^0+(?=\d)/, '')}.${decimal.replace(/0+$/, '')}`; }
  return same(value);
};
const present = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function reasonRequired(reason: string) { if (!present(reason)) throw new Error('Cần ghi rõ lý do / căn cứ cho quyết định này.'); }
function assertReviewable(c: ShipmentCase) { if (c.mergedInto) throw new Error('Hồ sơ đã được ghép; mở hồ sơ đích để tiếp tục.'); if (c.status === 'completed') throw new Error('Mở lại hồ sơ đã hoàn tất trước khi sửa đổi.'); }
function findCase(state: WorkspaceState, id: string) { const c = state.cases.find(c => c.id === id); if (!c) throw new Error('Không tìm thấy hồ sơ.'); return c; }
function findDocument(state: WorkspaceState, id: string) { const d = state.documents.find(d => d.id === id && d.active); if (!d) throw new Error('Không tìm thấy chứng từ đang hoạt động.'); return d; }
function documentsFor(state: WorkspaceState, c: ShipmentCase) { return state.documents.filter(d => d.caseId === c.id && d.active); }
function candidatesFor(state: WorkspaceState, caseId: string) { const ids = new Set(state.documents.filter(d => d.caseId === caseId && d.active).map(d => `${d.id}:${d.version}`)); return state.candidates.filter(c => c.caseId === caseId && ids.has(`${c.documentId}:${c.documentVersion}`)); }
function audit(state: WorkspaceState, actor: Actor, action: string, reason: string, extra: Partial<AuditEntry> = {}) { state.audit.push({ id: uid('audit'), at: now(), actor: actor.name, action, reason, ...extra }); }
function invalidate(state: WorkspaceState, c: ShipmentCase, actor: Actor, reason: string) {
  const priorApproval = c.approval;
  Object.values(c.fields).forEach(field => { field.stale = true; });
  c.goods.forEach(line => { line.reviewed = false; });
  c.resolutions = []; c.approval = undefined; c.status = 'review'; c.updatedAt = now();
  if (priorApproval) audit(state, actor, 'approval_invalidated', reason, { caseId: c.id, before: priorApproval, after: null });
}
function newCase(state: WorkspaceState, title: string, actor: Actor, type: ShipmentCase['caseType'] = 'import') {
  const at = now(); const c: ShipmentCase = { id: uid('case'), reference: `AICD-${String(state.cases.length + 1).padStart(4, '0')}`, title: title.trim() || 'Lô hàng mới', status: 'review', caseType: type, assignedTo: state.settings.defaultReviewer || actor.name, createdAt: at, updatedAt: at, documentIds: [], fields: {}, goods: [], groupingConfidence: 'low', groupingReason: 'Chưa có đủ định danh vận đơn / hóa đơn.', groupingConfirmed: false, synthetic: false, resolutions: [] };
  state.cases.push(c); audit(state, actor, 'case_created', 'Tạo hồ sơ để rà soát.', { caseId: c.id, after: { title: c.title, caseType: type } }); return c;
}
export function createEmptyWorkspace(id: string): WorkspaceState {
  return { id, name: 'AICD Workspace', revision: 0, cases: [], documents: [], candidates: [], audit: [], emails: [], snapshots: [], handoffs: [], settings: { inboxProvider: 'gmail', inboxAddress: '', inboxStatus: 'not_connected', defaultReviewer: '' } };
}

export function getProposedFields(state: WorkspaceState, caseId: string): Record<string, string> {
  const c = findCase(state, caseId); const candidates = candidatesFor(state, caseId); const result: Record<string, string> = {};
  for (const def of FIELD_DEFINITIONS) {
    const reviewed = c.fields[def.key];
    if (reviewed && !reviewed.stale) { result[def.key] = reviewed.value; continue; }
    if (def.manualOnly) continue;
    const values = candidates.filter(x => !x.lineId && x.field === def.key);
    if (new Set(values.map(x => sameField(x.field, x.value))).size === 1) result[def.key] = values[0].value;
  }
  return result;
}
function rebuildCandidatesAndGoods(state: WorkspaceState, c: ShipmentCase, preserveReviewed = false) {
  const activeVersions = new Set(documentsFor(state, c).map(d => `${d.id}:${d.version}`));
  state.candidates = state.candidates.filter(x => !activeVersions.has(`${x.documentId}:${x.documentVersion}`) || x.method.startsWith('kimi:'));
  // An unrelated intake must not erase reviewed AI evidence. A move changes its current case only.
  for (const candidate of state.candidates) if (activeVersions.has(`${candidate.documentId}:${candidate.documentVersion}`) && candidate.method.startsWith('kimi:')) candidate.caseId = c.id;
  const extracted = documentsFor(state, c).map(d => {
    derivePageTypes(d);
    const result = extractDocument(d);
    result.candidates.filter(x => d.transcribedPages?.includes(x.page)).forEach(x => { if (!x.method.startsWith('manual_transcription')) x.method = `manual_transcription + ${x.method}`; x.confidence = 'low'; });
    return { document: d, ...result };
  });
  state.candidates.push(...extracted.flatMap(x => x.candidates));
  // Prefer an explicitly identified invoice table; all other tables remain candidate evidence and are reconciled below.
  const table = extracted.find(x => documentHasType(x.document, 'invoice') && x.goods.length) ?? extracted.find(x => x.goods.length);
  if (!preserveReviewed || !c.goods.some(g => g.manual)) c.goods = table?.goods ?? [];
  else c.goods = c.goods.map(g => ({ ...g, reviewed: false }));
}
function groupingMatch(state: WorkspaceState, upload: UploadedDocument): { c?: ShipmentCase; reason: string; strong: boolean } {
  const probe: ShipmentDocument = { ...upload, caseId: '', type: classifyDocument(upload.name, upload.pages.map(p => p.text).join('\n')), version: 1, active: true, uploadedAt: now(), synthetic: !!upload.synthetic };
  const extracted = extractDocument(probe).candidates.filter(x => !x.lineId);
  const ids = extracted.filter(x => ['billOfLading', 'houseBillOfLading', 'masterBillOfLading', 'invoiceNumber', 'contractNumber', 'transportReference', 'container'].includes(x.field));
  const scored = state.cases.filter(c => c.status !== 'completed' && !c.mergedInto).map(c => {
    const existing = candidatesFor(state, c.id).filter(x => !x.lineId && !x.method.startsWith('kimi:'));
    const conflicts = ids.some(x => existing.some(v => v.field === x.field) && !existing.some(v => v.field === x.field && same(v.value) === same(x.value)));
    const matches = ids.filter(x => existing.some(v => v.field === x.field && same(v.value) === same(x.value)));
    const parties = extracted.filter(x => ['importer', 'exporter'].includes(x.field)).filter(x => existing.some(v => v.field === x.field && same(v.value) === same(x.value)));
    return { c, conflicts, score: matches.reduce((n, x) => n + (['billOfLading', 'houseBillOfLading', 'masterBillOfLading'].includes(x.field) ? 4 : ['invoiceNumber', 'transportReference'].includes(x.field) ? 3 : 1), 0), parties: parties.length };
  });
  const strong = scored.filter(x => x.score >= 3 && !x.conflicts).sort((a, b) => b.score - a.score);
  if (strong.length === 1) return { c: strong[0].c, strong: true, reason: 'Định danh vận đơn / hóa đơn trùng khớp, không có định danh trái ngược.' };
  const weak = scored.filter(x => x.parties >= 2 && !x.conflicts);
  if (strong.length === 0 && weak.length === 1) return { c: weak[0].c, strong: false, reason: 'Chỉ khớp các bên; cần xác nhận đây là cùng một lô hàng.' };
  return { strong: false, reason: strong.length > 1 ? 'Định danh khớp nhiều hồ sơ. Tạo riêng để người phụ trách ghép đúng.' : 'Không đủ định danh duy nhất; cần kiểm tra việc nhóm chứng từ.' };
}
function addUploads(state: WorkspaceState, uploads: UploadedDocument[], actor: Actor, targetCaseId?: string) {
  const added: string[] = []; let emailContextCase: ShipmentCase | undefined;
  if (targetCaseId) assertReviewable(findCase(state, targetCaseId));
  for (const upload of uploads) {
    if (!present(upload.id) || !present(upload.sha256) || !present(upload.name)) throw new Error('Chứng từ thiếu ID, tên hoặc SHA-256.');
    const duplicate = state.documents.find(d => d.sha256 === upload.sha256);
    if (duplicate) { audit(state, actor, 'duplicate_document_skipped', 'Bỏ qua bản có cùng SHA-256; giữ nguyên bản gốc.', { caseId: duplicate.caseId, after: { existingDocumentId: duplicate.id, uploadedName: upload.name } }); continue; }
    if (state.documents.some(d => d.id === upload.id)) throw new Error('ID chứng từ đã tồn tại.');
    const match = groupingMatch(state, upload);
    let c = targetCaseId ? findCase(state, targetCaseId) : match.c;
    let context = false;
    if (!c && upload.sourceEmailId && emailContextCase && !extractDocument({ ...upload, caseId: '', type: 'other', version: 1, active: true, uploadedAt: now(), synthetic: !!upload.synthetic }).candidates.some(x => ['invoiceNumber', 'billOfLading'].includes(x.field))) { c = emailContextCase; context = true; }
    if (!c) c = newCase(state, upload.name.replace(/\.[^.]+$/, ''), actor);
    invalidate(state, c, actor, 'Bộ chứng từ thay đổi: cần rà soát lại các quyết định.');
    const d: ShipmentDocument = { ...structuredClone(upload), caseId: c.id, type: classifyDocument(upload.name, upload.pages.map(p => p.text).join('\n')), version: 1, active: true, uploadedAt: now(), synthetic: !!upload.synthetic };
    state.documents.push(d); c.documentIds.push(d.id); added.push(d.id); c.synthetic = documentsFor(state, c).every(x => x.synthetic);
    c.groupingConfidence = !targetCaseId && match.strong ? 'high' : 'medium';
    c.groupingReason = targetCaseId ? 'Người dùng chọn hồ sơ nhận chứng từ; cần xác nhận toàn bộ nhóm.' : context ? 'Nhóm theo email; chưa có định danh đủ mạnh.' : match.reason;
    c.groupingConfirmed = false; emailContextCase = c;
    rebuildCandidatesAndGoods(state, c, true);
    audit(state, actor, 'document_received', c.groupingReason, { caseId: c.id, after: { documentId: d.id, name: d.name, type: d.type, sha256: d.sha256, extractionStatus: d.extractionStatus } });
    const normals = state.candidates.filter(x => x.documentId === d.id && x.normalizations.length);
    for (const candidate of normals) audit(state, actor, 'safe_normalization', candidate.normalizations.map(x => x.reason).join(' '), { caseId: c.id, field: candidate.field, before: candidate.normalizations[0].before, after: candidate.value });
  }
  return added;
}

function fingerprint(value: unknown) { const text = JSON.stringify(value); let hash = 2166136261; for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16); }
export function getIssues(state: WorkspaceState, caseId?: string): Issue[] {
  const issues: Issue[] = [];
  for (const c of state.cases.filter(x => !x.mergedInto && (!caseId || x.id === caseId))) {
    const docs = documentsFor(state, c); const candidates = candidatesFor(state, c.id); const proposed = getProposedFields(state, c.id);
    const add = (key: string, kind: Issue['kind'], title: string, description: string, field?: string, evidence: Candidate[] = [], documentIds: string[] = [], inherentlyResolved = false, severity: Issue['severity'] = 'error') => {
      const fp = fingerprint({ key, description, values: evidence.map(x => [x.id, x.value]), docs: documentIds.map(id => { const d = state.documents.find(x => x.id === id); return [id, d?.version]; }), fieldValue: field ? c.fields[field] : undefined, goods: kind === 'goods' ? c.goods : undefined });
      const id = `${c.id}:${key}`; const resolution = c.resolutions.find(r => r.issueId === id && r.fingerprint === fp);
      issues.push({ id, caseId: c.id, kind, title, description, field, candidateIds: evidence.map(x => x.id), documentIds: [...new Set([...documentIds, ...evidence.map(x => x.documentId)])], severity, fingerprint: fp, resolved: inherentlyResolved || !!resolution, resolution });
    };
    if (c.caseType === 'unsupported') add('unsupported', 'unsupported', 'Loại hồ sơ chưa hỗ trợ', 'Phase 1 hỗ trợ bản nháp nhập khẩu. Cần chuyển về luồng nhập khẩu phù hợp hoặc xử lý ngoài hệ thống.');
    if (!c.groupingConfirmed) add('grouping', 'grouping', 'Xác nhận nhóm chứng từ', c.groupingReason, undefined, [], docs.map(d => d.id));
    if (!docs.some(d => documentHasType(d, 'invoice'))) add('missing-invoice', 'missing', 'Thiếu hóa đơn', 'Bộ kiểm tra hồ sơ của bản thử nghiệm cần hóa đơn thương mại. Đây không phải yêu cầu pháp lý được xác minh.');
    if (!docs.some(d => documentHasType(d, 'packing_list'))) add('missing-packing', 'missing', 'Thiếu phiếu đóng gói', 'Cần phiếu đóng gói để đối chiếu số lượng, kiện và trọng lượng.');
    if (!docs.some(d => documentHasType(d, 'bill_of_lading') || documentHasType(d, 'air_waybill'))) add('missing-transport', 'missing', 'Thiếu vận đơn', 'Cần vận đơn đường biển hoặc hàng không để đối chiếu vận chuyển.');
    for (const d of docs) {
      if (d.extractionStatus !== 'extracted' || pagesNeedingReview(d.pages).length) add(`document-${d.id}`, 'document', d.extractionStatus === 'needs_transcription' || pagesNeedingReview(d.pages).length ? 'Chứng từ cần nhập nội dung' : 'Chưa đọc được chứng từ', d.extractionError || assessExtraction(d.pages).extractionError || NO_USABLE_EXTRACTION, undefined, [], [d.id]);
      else if (!d.pages.some(p => p.text.trim())) add(`empty-${d.id}`, 'document', 'Chứng từ không có nội dung', 'Không có trang văn bản để đối chiếu.', undefined, [], [d.id]);
      else if (!candidates.some(x => x.documentId === d.id)) add(`layout-${d.id}`, 'uncertain', 'Bố cục chưa trích xuất được', 'Trình đọc nhãn / bảng chưa nhận diện được dữ liệu. Đối chiếu nguồn và nhập các giá trị thủ công, sau đó ghi lý do xác nhận.', undefined, [], [d.id]);
      if (d.type === 'other' && !d.classificationConfirmed) add(`classification-${d.id}`, 'document', 'Chứng từ chưa phân loại', 'Chọn loại chứng từ sau khi kiểm tra nội dung.', undefined, [], [d.id]);
      const pageNumbers = d.pages.map(p => p.page);
      if (pageNumbers.length && (Math.min(...pageNumbers) !== 1 || new Set(pageNumbers).size !== pageNumbers.length || Math.max(...pageNumbers) !== pageNumbers.length)) add(`pages-${d.id}`, 'document', 'Thứ tự trang cần kiểm tra', 'Các số trang không liên tục hoặc trùng lặp; cần thay thế bằng bộ trang đầy đủ.', undefined, [], [d.id]);
    }
    for (const def of FIELD_DEFINITIONS) {
      const values = candidates.filter(x => x.field === def.key && !x.lineId); const reviewed = c.fields[def.key]; const validReview = !!reviewed && !reviewed.stale && present(reviewed.value);
      const distinct = new Set(values.map(x => sameField(x.field, x.value)));
      if (def.required && !validReview && !values.length) add(`missing-${def.key}`, 'missing', `Thiếu ${def.label.toLowerCase()}`, 'Không có giá trị nguồn hoặc giá trị nhập tay đã rà soát.', def.key);
      if (distinct.size > 1) add(`conflict-${def.key}`, 'conflict', `Mâu thuẫn ${def.label.toLowerCase()}`, 'Nguồn ghi các giá trị khác nhau. Chọn giá trị hoặc nhập hiệu chỉnh và ghi căn cứ.', def.key, values, [], validReview && present(reviewed.reason));
      if (reviewed?.stale) add(`stale-${def.key}`, 'stale', `Rà soát lại ${def.label.toLowerCase()}`, 'Bộ chứng từ đã thay đổi kể từ quyết định trước. Cần lưu lại quyết định trên nguồn hiện tại.', def.key, values);
      else if (!validReview && values.length && !def.manualOnly && distinct.size <= 1) add(`review-${def.key}`, 'uncertain', `Rà soát ${def.label.toLowerCase()}`, values.some(x => x.confidence !== 'high') ? 'Nguồn có giá trị chưa chắc chắn hoặc định dạng mơ hồ; cần kiểm tra và xác nhận.' : 'Giá trị mới chỉ là đề xuất từ nguồn; cần người rà soát xác nhận.', def.key, values);
    }
    if (!c.goods.length) add('goods-missing', 'goods', 'Thiếu dòng hàng', 'Chưa có bảng hàng có thể rà soát; cần nhập ít nhất một dòng hàng.');
    else {
      if (c.goods.some(g => !g.reviewed)) add('goods-review', 'goods', 'Rà soát dòng hàng', 'Xác nhận mô tả, số lượng, đơn vị và trị giá từng dòng. HS, xuất xứ và thuế chỉ được nhập tay, chưa xác minh.');
      for (const g of c.goods) {
        if (!present(g.description) || !present(g.unit) || parseNumber(g.quantity) === undefined || Number(g.quantity) <= 0 || parseNumber(g.amount) === undefined) add(`goods-incomplete-${g.id}`, 'goods', 'Dòng hàng thiếu dữ liệu', 'Mỗi dòng cần mô tả, đơn vị, số lượng dương và thành tiền ở định dạng số rõ ràng.');
        const qty = parseNumber(g.quantity), price = parseNumber(g.unitPrice), amount = parseNumber(g.amount);
        if (qty !== undefined && price !== undefined && amount !== undefined && Math.abs(qty * price - amount) > 0.01) add(`goods-math-${g.id}`, 'goods', 'Thành tiền dòng chưa khớp', `${g.description}: số lượng × đơn giá = ${(qty * price).toFixed(2)}, thành tiền = ${g.amount}. Kiểm tra chiết khấu hoặc sai khác.`, undefined, candidates.filter(x => x.lineId === g.id));
      }
      const total = parseNumber(proposed.invoiceTotal || ''); const amounts = c.goods.map(g => parseNumber(g.amount));
      if (total !== undefined && amounts.every(x => x !== undefined)) { const sum = amounts.reduce<number>((n, x) => n + (x ?? 0), 0); if (Math.abs(total - sum) > 0.01) add('goods-total', 'goods', 'Tổng dòng hàng chưa khớp hóa đơn', `Tổng thành tiền ${sum.toFixed(2)}; trị giá hóa đơn ${total.toFixed(2)}. Cần giải thích phí, chiết khấu hoặc hiệu chỉnh.`, 'invoiceTotal', candidates.filter(x => x.field === 'invoiceTotal')); }
    }
    const net = parseNumber(proposed.netWeight || ''), gross = parseNumber(proposed.grossWeight || '');
    if (net !== undefined && gross !== undefined && net > gross) add('weight', 'goods', 'Trọng lượng tịnh lớn hơn cả bì', `Trọng lượng tịnh ${net}; cả bì ${gross}. Kiểm tra đơn vị và nguồn.`, 'netWeight', candidates.filter(x => ['netWeight', 'grossWeight'].includes(x.field)));
    // Reconcile repeated descriptions, quantities, units and prices across all document tables.
    const groups = new Map<string, Candidate[]>();
    for (const desc of candidates.filter(x => x.lineId && x.field === 'description')) { const key = same(desc.value); groups.set(key, [...(groups.get(key) ?? []), desc]); }
    for (const [description, descriptions] of groups) {
      if (new Set(descriptions.map(x => `${x.documentId}:${x.page}`)).size < 2) continue;
      for (const field of ['quantity', 'unit', 'unitPrice', 'amount']) {
        const lineIds = new Set(descriptions.map(x => x.lineId)); const evidence = candidates.filter(x => x.field === field && lineIds.has(x.lineId));
        const unitValues = candidates.filter(x => x.field === 'unit' && lineIds.has(x.lineId));
        if (field !== 'unit' && new Set(unitValues.map(x => same(x.value))).size > 1) continue;
        if (new Set(evidence.map(x => sameField(x.field, x.value))).size > 1) add(`line-conflict-${fingerprint(description)}-${field}`, 'conflict', `Mâu thuẫn dòng hàng: ${field}`, `${description}: các bảng chứng từ ghi khác nhau. Rà soát dòng hàng và ghi rõ quyết định xử lý.`, undefined, evidence, [], c.goods.every(g => g.reviewed) && c.goods.some(g => same(g.description) === description && present(g.reason)));
      }
    }
    const sourceDescriptions = docs.flatMap(d => d.pages.filter(page => ['invoice', 'packing_list'].includes(pageDocumentType(d, page))).map(page => { const descriptions = candidates.filter(x => x.documentId === d.id && x.page === page.page && x.field === 'description' && x.lineId && candidates.some(q => q.lineId === x.lineId && q.field === 'quantity')); return { d, values: descriptions.map(x => same(x.value)).sort(), units: candidates.filter(x => x.documentId === d.id && x.page === page.page && x.field === 'unit').map(x => same(x.value)) }; })).filter(x => x.values.length);
    const comparableDescriptions = sourceDescriptions.filter(x => !x.units.length || sourceDescriptions[0].units.some(unit => x.units.includes(unit)));
    if (comparableDescriptions.length > 1 && new Set(comparableDescriptions.map(x => JSON.stringify(x.values))).size > 1) add('goods-description-conflict', 'conflict', 'Danh sách hàng giữa chứng từ khác nhau', 'Mô tả / số dòng trên hóa đơn và phiếu đóng gói không trùng. Cần đối chiếu bảng hàng và ghi lý do xử lý.', undefined, candidates.filter(x => x.lineId && x.field === 'description'), [], c.goods.every(g => g.reviewed) && c.goods.every(g => present(g.reason)));
    for (const field of ['invoiceTotal', 'packageCount', 'grossWeight', 'netWeight']) {
      const reviewed = c.fields[field];
      if (reviewed && !reviewed.stale && reviewed.value && parseNumber(reviewed.value) === undefined) add(`number-${field}`, 'uncertain', 'Giá trị số cần làm rõ', 'Nhập số không có dấu phân nhóm, dùng dấu chấm cho phần thập phân.', field);
    }
    const date = c.fields.invoiceDate;
    if (date && !date.stale && (!/^\d{4}-\d{2}-\d{2}$/.test(date.value) || Number.isNaN(Date.parse(date.value)) || new Date(date.value).toISOString().slice(0, 10) !== date.value)) add('date-format', 'uncertain', 'Ngày hóa đơn cần làm rõ', 'Xác nhận ngày thực tế và nhập YYYY-MM-DD để loại bỏ định dạng mơ hồ.', 'invoiceDate');
    const recentRun = state.handoffs.filter(h => h.caseId === c.id).at(-1);
    if (recentRun?.status === 'failed' && recentRun.snapshotId === c.approval?.snapshotId) add('transfer', 'transfer', 'Tạo nháp ECUS thử nghiệm thất bại', recentRun.message);
  }
  return issues;
}

function clearApproval(state: WorkspaceState, c: ShipmentCase, actor: Actor, reason: string) {
  if (c.approval) audit(state, actor, 'approval_invalidated', reason, { caseId: c.id, before: c.approval, after: null });
  c.approval = undefined; c.status = 'review'; c.updatedAt = now();
}
/** Clones before mutation. The API must additionally enforce authenticated membership and a revision CAS. */
export function applyAction(original: WorkspaceState, action: Action, actor: Actor): WorkspaceState {
  if (!present(actor.id) || !present(actor.name)) throw new Error('Cần người dùng đã đăng nhập có tên để ghi nhật ký.');
  const state = structuredClone(original);
  if (action.type === 'seed_demo') {
    if (state.documents.some(d => d.synthetic)) throw new Error('Dữ liệu demo đã có trong workspace.');
    for (const sample of syntheticShipments()) {
      const c = newCase(state, sample.title, actor); addUploads(state, sample.documents, actor, c.id);
      if (sample.documents.length > 1) { c.groupingConfirmed = true; c.groupingConfidence = 'high'; c.groupingReason = 'Bộ chứng từ tổng hợp đã được tạo cùng một lô hàng; không phải kết quả đánh giá trên khách hàng thật.'; }
    }
    audit(state, actor, 'demo_seeded', 'Người dùng chủ động nạp 3 bộ dữ liệu tổng hợp; không có chứng từ khách hàng thật.');
  } else if (action.type === 'create_case') {
    if (!present(action.title)) throw new Error('Cần tên hồ sơ.');
    newCase(state, action.title, actor, action.caseType);
  } else if (action.type === 'add_ai_candidates') {
    // Internal server-only action. The public mutation schema deliberately does not expose it.
    const c = findCase(state, action.caseId); assertReviewable(c);
    const document = findDocument(state, action.documentId);
    if (document.caseId !== c.id || document.version !== action.documentVersion) throw new Error('Chứng từ đã thay đổi; cần gửi lại yêu cầu trên bản hiện tại.');
    const pages = selectKimiPages(document, action.pages);
    const grounded = groundKimiProposals(document, pages, action.proposals, action.model);
    const existing = candidatesFor(state, c.id);
    const fresh = grounded.candidates.filter(candidate => !existing.some(prior => prior.documentId === candidate.documentId && prior.documentVersion === candidate.documentVersion && prior.field === candidate.field && prior.page === candidate.page && prior.value === candidate.value && prior.originalText === candidate.originalText && prior.method === candidate.method));
    if (fresh.length) {
      const affected = new Set(fresh.map(candidate => candidate.field));
      for (const field of affected) if (c.fields[field]) c.fields[field].stale = true;
      c.resolutions = [];
      clearApproval(state, c, actor, 'Có đề xuất Kimi mới; cần rà soát lại các trường bị ảnh hưởng.');
      state.candidates.push(...fresh);
      for (const candidate of fresh.filter(candidate => candidate.normalizations.length)) audit(state, actor, 'safe_normalization', candidate.normalizations.map(change => change.reason).join(' '), { caseId: c.id, field: candidate.field, before: candidate.normalizations[0].before, after: candidate.value });
    }
    audit(state, actor, 'ai_header_proposals_received', 'Người dùng đồng ý gửi các trang văn bản đã chọn đến Moonshot International. Đề xuất cần được người phụ trách rà soát; không phải xác minh dữ liệu hay quyết định hải quan.', { caseId: c.id, after: { provider: 'Moonshot International', endpoint: KIMI_ENDPOINT, model: action.model, scope: 'header_facts_text_only', documentId: document.id, documentVersion: document.version, pages: pages.map(page => page.page), added: fresh.length, rejected: grounded.rejected, duplicate: grounded.candidates.length - fresh.length, candidateIds: fresh.map(candidate => candidate.id) } });
  } else if (action.type === 'intake') {
    if (!action.documents.length && !action.email) throw new Error('Chưa chọn chứng từ để tải lên.');
    const existingEmail = action.email && state.emails.find(e => e.messageId === action.email!.messageId || e.sha256 === action.email!.sha256);
    if (existingEmail) audit(state, actor, 'duplicate_email_skipped', 'Email đã nhận trước đó (Message-ID hoặc SHA-256 trùng).', { after: { emailId: existingEmail.id } });
    else {
      const ids = addUploads(state, action.documents, actor, action.targetCaseId);
      if (action.email) {
        const email = structuredClone(action.email);
        email.documentIds = [...new Set([...email.documentIds.filter(id => state.documents.some(d => d.id === id)), ...ids, ...action.documents.flatMap(d => state.documents.filter(existing => existing.sha256 === d.sha256).map(x => x.id))])];
        state.emails.push(email);
        audit(state, actor, 'email_received', 'Lưu nguyên bản email và thông tin nguồn. Không gửi email tự động.', { after: { emailId: email.id, sender: email.sender, receivedAt: email.receivedAt, documentIds: email.documentIds } });
      }
    }
  } else if (action.type === 'review_field') {
    const c = findCase(state, action.caseId); assertReviewable(c);
    const definition = FIELD_DEFINITIONS.find(f => f.key === action.field); if (!definition) throw new Error('Trường dữ liệu chưa được hỗ trợ.');
    const values = candidatesFor(state, c.id).filter(x => !x.lineId && x.field === action.field);
    const candidate = action.candidateId ? values.find(x => x.id === action.candidateId) : undefined;
    if (action.candidateId && !candidate) throw new Error('Ứng viên không thuộc trường / hồ sơ / phiên bản chứng từ đang dùng.');
    const value = action.value.trim(); const manual = definition.manualOnly || !candidate || value !== candidate.value;
    const conflict = new Set(values.map(x => sameField(x.field, x.value))).size > 1;
    if (manual || conflict || candidate?.confidence !== 'high') reasonRequired(action.reason);
    if (definition.required && !value) throw new Error('Trường bắt buộc không được để trống.');
    const before = c.fields[action.field];
    const reviewed: ReviewedValue = { value, source: manual ? 'manual' : 'candidate', candidateId: candidate?.id, reason: action.reason.trim() || 'Đã đối chiếu với chứng từ nguồn.', reviewedBy: actor.name, reviewedAt: now(), stale: false, unverified: !!definition.manualOnly };
    clearApproval(state, c, actor, 'Giá trị đã rà soát thay đổi.'); c.fields[action.field] = reviewed;
    audit(state, actor, 'field_reviewed', reviewed.reason, { caseId: c.id, field: action.field, before: before ?? null, after: reviewed });
  } else if (action.type === 'review_goods') {
    const c = findCase(state, action.caseId); assertReviewable(c); reasonRequired(action.reason);
    if (!action.goods.length) throw new Error('Cần ít nhất một dòng hàng.');
    if (new Set(action.goods.map(g => g.id)).size !== action.goods.length) throw new Error('ID dòng hàng bị trùng.');
    const before = structuredClone(c.goods);
    const activeDocs = documentsFor(state, c); const existingCandidates = candidatesFor(state, c.id);
    c.goods = action.goods.map(g => {
      if (!present(g.id)) throw new Error('Dòng hàng cần ID.');
      if (g.sourceDocumentId) {
        const source = activeDocs.find(d => d.id === g.sourceDocumentId);
        if (!source || (g.sourcePage && !source.pages.some(p => p.page === g.sourcePage))) throw new Error('Nguồn dòng hàng phải thuộc chứng từ đang hoạt động trong hồ sơ.');
        const originalLine = existingCandidates.find(x => x.lineId === g.id && x.documentId === g.sourceDocumentId);
        if (originalLine && g.originalText !== originalLine.originalText) throw new Error('Không được thay đổi văn bản nguồn của dòng hàng.');
      }
      const old = before.find(x => x.id === g.id);
      const changed = !old || ['description', 'quantity', 'unit', 'unitPrice', 'amount', 'hsCode', 'origin', 'dutyRate', 'vatRate'].some(key => g[key as keyof GoodsLine] !== old[key as keyof GoodsLine]);
      return { ...structuredClone(g), reviewed: true, manual: changed || !g.sourceDocumentId || !!g.hsCode || !!g.origin || !!g.dutyRate || !!g.vatRate, reason: action.reason.trim() };
    });
    clearApproval(state, c, actor, 'Bảng hàng đã thay đổi.');
    audit(state, actor, 'goods_reviewed', action.reason.trim(), { caseId: c.id, before, after: c.goods });
  } else if (action.type === 'resolve_issue') {
    const c = findCase(state, action.caseId); assertReviewable(c); reasonRequired(action.reason);
    const issue = getIssues(state, c.id).find(i => i.id === action.issueId); if (!issue || issue.resolved) throw new Error('Vấn đề không còn cần xử lý.');
    const explainable = ['goods-total', 'weight'].some(suffix => issue.id === `${c.id}:${suffix}`) || issue.id.startsWith(`${c.id}:goods-math-`) || (issue.kind === 'uncertain' && !issue.field);
    if (!explainable) throw new Error('Cần sửa dữ liệu / rà soát giá trị / xác nhận nhóm để xử lý vấn đề này; không thể chỉ bỏ qua.');
    clearApproval(state, c, actor, 'Quyết định xử lý vấn đề thay đổi.');
    c.resolutions = c.resolutions.filter(r => r.issueId !== issue.id);
    c.resolutions.push({ issueId: issue.id, fingerprint: issue.fingerprint, reason: action.reason.trim(), actor: actor.name, at: now() });
    audit(state, actor, 'issue_resolved', action.reason.trim(), { caseId: c.id, before: issue, after: c.resolutions.at(-1) });
  } else if (action.type === 'confirm_grouping') {
    const c = findCase(state, action.caseId); assertReviewable(c); reasonRequired(action.reason);
    if (!documentsFor(state, c).length) throw new Error('Chưa có chứng từ để xác nhận nhóm.');
    clearApproval(state, c, actor, 'Xác nhận nhóm chứng từ.');
    c.groupingConfirmed = true; c.groupingReason = action.reason.trim();
    audit(state, actor, 'grouping_confirmed', action.reason.trim(), { caseId: c.id, after: c.documentIds });
  } else if (action.type === 'move_documents' || action.type === 'merge_cases') {
    let ids: string[]; let target: ShipmentCase;
    if (action.type === 'merge_cases') {
      if (action.sourceCaseId === action.targetCaseId) throw new Error('Không thể ghép hồ sơ vào chính nó.');
      const source = findCase(state, action.sourceCaseId); assertReviewable(source); target = findCase(state, action.targetCaseId);
      ids = documentsFor(state, source).map(d => d.id);
    } else { ids = [...new Set(action.documentIds)]; target = action.targetCaseId ? findCase(state, action.targetCaseId) : newCase(state, action.title || 'Lô hàng tách mới', actor); }
    assertReviewable(target); if (!ids.length) throw new Error('Chọn ít nhất một chứng từ để chuyển.');
    const affected = new Set<string>([target.id]);
    for (const id of ids) {
      const document = findDocument(state, id); const source = findCase(state, document.caseId); assertReviewable(source);
      if (source.id === target.id) continue;
      affected.add(source.id); source.documentIds = source.documentIds.filter(x => x !== id); target.documentIds.push(id); document.caseId = target.id;
      audit(state, actor, action.type === 'merge_cases' ? 'case_documents_merged' : 'document_moved', 'Người dùng sửa nhóm chứng từ; cần xác nhận và rà soát lại.', { caseId: target.id, before: { documentId: id, caseId: source.id }, after: { documentId: id, caseId: target.id } });
    }
    for (const id of affected) {
      const c = findCase(state, id); invalidate(state, c, actor, 'Chứng từ được chuyển / ghép hồ sơ.'); c.groupingConfirmed = false; c.groupingConfidence = 'medium'; c.groupingReason = 'Nhóm đã thay đổi thủ công; cần xác nhận lại.'; c.synthetic = documentsFor(state, c).length > 0 && documentsFor(state, c).every(d => d.synthetic); rebuildCandidatesAndGoods(state, c, true);
    }
    if (action.type === 'merge_cases') {
      const source = findCase(state, action.sourceCaseId);
      if (!documentsFor(state, source).length) {
        source.mergedInto = target.id;
        audit(state, actor, 'case_merged', 'Hồ sơ nguồn được giữ làm lịch sử và liên kết đến hồ sơ đích; không đánh dấu hoàn tất.', { caseId: source.id, after: { mergedInto: target.id } });
      }
    }
  } else if (action.type === 'replace_document') {
    const previous = findDocument(state, action.documentId); const c = findCase(state, previous.caseId); assertReviewable(c);
    const upload = action.document;
    if (state.documents.some(d => d.sha256 === upload.sha256)) throw new Error('Bản thay thế trùng nội dung đã lưu; không tạo phiên bản mới.');
    if (state.documents.some(d => d.id === upload.id)) throw new Error('ID bản thay thế phải là ID mới.');
    previous.active = false;
    const replacement: ShipmentDocument = { ...structuredClone(upload), caseId: c.id, type: classifyDocument(upload.name, upload.pages.map(p => p.text).join('\n')), version: previous.version + 1, active: true, replacesId: previous.id, uploadedAt: now(), synthetic: !!upload.synthetic };
    state.documents.push(replacement); c.documentIds.push(replacement.id);
    invalidate(state, c, actor, 'Chứng từ được thay thế; các quyết định trước không còn được coi là hiện hành.'); c.groupingConfirmed = false; c.groupingReason = 'Có phiên bản chứng từ mới; cần xác nhận vẫn thuộc cùng hồ sơ.'; rebuildCandidatesAndGoods(state, c, true);
    audit(state, actor, 'document_replaced', 'Giữ nguyên bản cũ và lưu phiên bản thay thế.', { caseId: c.id, before: { documentId: previous.id, version: previous.version, sha256: previous.sha256 }, after: { documentId: replacement.id, version: replacement.version, sha256: replacement.sha256 } });
  } else if (action.type === 'classify_document') {
    const document = findDocument(state, action.documentId); const c = findCase(state, document.caseId); assertReviewable(c);
    if (!(action.documentType in DOCUMENT_LABELS)) throw new Error('Loại chứng từ không hợp lệ.');
    const before = document.type; document.type = action.documentType; document.classificationConfirmed = true; document.version++;
    invalidate(state, c, actor, 'Phân loại chứng từ thay đổi.'); c.groupingConfirmed = false; rebuildCandidatesAndGoods(state, c, true);
    audit(state, actor, 'document_classified', 'Người rà soát chọn loại chứng từ.', { caseId: c.id, before, after: action.documentType });
  } else if (action.type === 'transcribe_document') {
    const document = findDocument(state, action.documentId); const c = findCase(state, document.caseId); assertReviewable(c); reasonRequired(action.reason);
    if (!action.pages.length || !action.pages.some(p => p.text.trim()) || action.pages.some(p => !Number.isInteger(p.page) || p.page < 1)) throw new Error('Cần nội dung trang và số trang dương hợp lệ.');
    const before = { version: document.version, pages: structuredClone(document.pages), extractionStatus: document.extractionStatus };
    const merged = new Map(document.pages.map(p => [p.page, p]));
    for (const page of action.pages) merged.set(page.page, { page: page.page, text: page.text, textSource: 'manual', documentType: page.documentType });
    document.pages = [...merged.values()].sort((a, b) => a.page - b.page);
    document.transcribedPages = [...new Set([...(document.transcribedPages ?? []), ...action.pages.map(p => p.page)])];
    document.version++;
    const assessment = assessExtraction(document.pages);
    document.extractionStatus = assessment.extractionStatus;
    document.extractionError = assessment.extractionError;
    if (document.type === 'other') document.type = classifyDocument(document.name, document.pages.map(p => p.text).join('\n'));
    invalidate(state, c, actor, 'Nội dung chép từ chứng từ thay đổi.'); c.groupingConfirmed = false; rebuildCandidatesAndGoods(state, c, true);
    state.candidates.filter(x => x.documentId === document.id && x.documentVersion === document.version && document.transcribedPages?.includes(x.page)).forEach(x => { if (!x.method.startsWith('manual_transcription')) if (!x.method.startsWith('manual_transcription')) x.method = `manual_transcription + ${x.method}`; x.confidence = 'low'; });
    audit(state, actor, 'document_transcribed', action.reason.trim(), { caseId: c.id, before, after: { documentId: document.id, version: document.version, pages: document.pages } });
  } else if (action.type === 'update_case') {
    const c = findCase(state, action.caseId); assertReviewable(c); const before = { title: c.title, assignedTo: c.assignedTo, caseType: c.caseType };
    if (action.title !== undefined) { if (!present(action.title)) throw new Error('Tên hồ sơ không được trống.'); c.title = action.title.trim(); }
    if (action.assignedTo !== undefined) { if (!present(action.assignedTo)) throw new Error('Cần người phụ trách.'); c.assignedTo = action.assignedTo.trim(); }
    if (action.caseType && c.caseType !== action.caseType) { c.caseType = action.caseType; invalidate(state, c, actor, 'Loại hồ sơ thay đổi.'); }
    c.updatedAt = now(); audit(state, actor, 'case_updated', 'Cập nhật thông tin hồ sơ.', { caseId: c.id, before, after: { title: c.title, assignedTo: c.assignedTo, caseType: c.caseType } });
  } else if (action.type === 'approve') {
    const c = findCase(state, action.caseId); assertReviewable(c);
    const unresolved = getIssues(state, c.id).filter(i => !i.resolved);
    if (unresolved.length) throw new Error(`Còn ${unresolved.length} vấn đề chưa xử lý; chưa thể đóng băng bản rà soát.`);
    if (c.approval) throw new Error('Bản hiện tại đã được phê duyệt.');
    const id = uid('snapshot'); const at = now(); c.status = 'approved'; c.approval = { actor: actor.name, at, snapshotId: id }; c.updatedAt = at;
    state.snapshots.push({ id, caseId: c.id, createdAt: at, actor: actor.name, version: state.snapshots.filter(s => s.caseId === c.id).length + 1, declaration: structuredClone(c), documents: structuredClone(documentsFor(state, c)), candidates: structuredClone(candidatesFor(state, c.id)), issues: structuredClone(getIssues(state, c.id)), customsValidation: 'Not yet assessed' });
    audit(state, actor, 'snapshot_approved', 'Đóng băng bản rà soát nghiệp vụ AICD. Không phải phê duyệt hải quan hay xác nhận tuân thủ.', { caseId: c.id, after: { snapshotId: id } });
  } else if (action.type === 'handoff') {
    const c = findCase(state, action.caseId);
    if (c.status !== 'approved' || !c.approval) throw new Error('Phê duyệt và đóng băng bản rà soát trước khi tạo nháp ECUS thử nghiệm.');
    if (getIssues(state, c.id).some(i => !i.resolved && i.kind !== 'transfer')) throw new Error('Còn vấn đề phải xử lý trước khi tạo nháp.');
    const snapshot = state.snapshots.find(s => s.id === c.approval!.snapshotId); if (!snapshot) throw new Error('Không tìm thấy bản đóng băng.');
    const existing = successfulRunForSnapshot(state.handoffs, snapshot.id);
    if (existing) audit(state, actor, 'handoff_idempotent_reuse', 'Bản đóng băng này đã có nháp TEST; trả về cùng kết quả, không tạo trùng.', { caseId: c.id, after: { runId: existing.id, draftReference: existing.draftReference } });
    else {
      const idempotencyKey = `aicd:${state.id}:${snapshot.id}`; const result = simulateTestDraft(snapshot, idempotencyKey, action.simulateFailure);
      const run = { id: uid('handoff'), caseId: c.id, snapshotId: snapshot.id, idempotencyKey, at: now(), actor: actor.name, connector: 'test' as const, ...result, idaStatus: 'not_transmitted' as const, idcStatus: 'not_registered' as const, customsOutcome: 'not_assessed' as const };
      state.handoffs.push(run); audit(state, actor, 'ecus_test_handoff', result.message, { caseId: c.id, after: run });
    }
  } else if (action.type === 'complete') {
    const c = findCase(state, action.caseId); reasonRequired(action.reason); assertReviewable(c);
    if (![actor.id, actor.name, actor.email].includes(c.assignedTo)) throw new Error('Chỉ người phụ trách hồ sơ được đánh dấu hoàn tất.');
    if (!c.approval || c.status !== 'approved') throw new Error('Cần phê duyệt bản rà soát hiện tại trước khi hoàn tất.');
    if (getIssues(state, c.id).some(i => !i.resolved)) throw new Error('Vẫn còn việc cần xử lý; hồ sơ phải ở hàng đợi.');
    c.status = 'completed'; c.completedBy = actor.name; c.completedAt = now(); c.updatedAt = c.completedAt;
    audit(state, actor, 'case_completed', action.reason.trim(), { caseId: c.id, after: { snapshotId: c.approval.snapshotId, completedBy: actor.name } });
  } else if (action.type === 'reopen') {
    const c = findCase(state, action.caseId); reasonRequired(action.reason);
    if (c.mergedInto) throw new Error('Hồ sơ đã được ghép; mở hồ sơ đích để tiếp tục.');
    const before = c.status;
    c.status = 'review'; c.completedBy = undefined; c.completedAt = undefined; c.approval = undefined; c.updatedAt = now();
    audit(state, actor, 'case_reopened', action.reason.trim(), { caseId: c.id, before, after: 'review' });
  } else if (action.type === 'settings') {
    const before = structuredClone(state.settings);
    if (action.inboxAddress !== undefined) state.settings.inboxAddress = action.inboxAddress.trim();
    if (action.defaultReviewer !== undefined) state.settings.defaultReviewer = action.defaultReviewer.trim();
    state.settings.inboxStatus = 'not_connected';
    audit(state, actor, 'settings_updated', 'Cấu hình Gmail chưa kết nối OAuth; địa chỉ không cấp quyền truy cập.', { before, after: state.settings });
  } else throw new Error('Hành động không được hỗ trợ.');
  state.revision = original.revision + 1;
  return state;
}
