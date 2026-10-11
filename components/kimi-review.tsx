"use client";

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, CheckCheck, FileText, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { ShipmentDocument, WorkspaceResponse } from '@/lib/types';
import { fetchWithSession } from '@/lib/auth-client';
import { useLocale } from '@/lib/i18n';
import { translateSystemText } from '@/lib/i18n-core';
import { selectedAiPages, type AiLimits } from '@/lib/ai-selection';

type AiStatus = { configured: boolean; model: string | null; endpoint: string; provider: string; limits: AiLimits; missing?: string[] };
type AiResponse = WorkspaceResponse & { error?: string; ai?: { added: number; rejected: number; model: string; documentId: string; pages: number[] } };

function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetchWithSession('/api/ai/status', { signal: controller.signal }).then(async response => {
      const body = await response.json() as AiStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Không thể kiểm tra kết nối Kimi.');
      setStatus(body);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Không thể kiểm tra kết nối Kimi.'); });
    return () => controller.abort();
  }, []);
  return { status, error };
}

export function AiSettingsCard() {
  const { t, locale } = useLocale(); const { status, error } = useAiStatus();
  return <section className="card settings-card ai-settings-card"><div className="section-heading"><h2><Sparkles size={19} />Kimi · Moonshot International</h2><span className={`badge ${status?.configured ? 'green' : 'amber'}`}>{status ? t(status.configured ? 'Đã cấu hình phía máy chủ' : 'Chưa cấu hình') : t('Đang kiểm tra…')}</span></div>
    <p>{t('Kimi chỉ đề xuất thông tin đầu hồ sơ từ văn bản các trang bạn chọn. Chỉ gửi khi bạn yêu cầu rõ ràng; mọi đề xuất vẫn cần người rà soát xác nhận.')}</p>
    <dl className="ai-configuration"><div><dt>{t('Nhà cung cấp')}</dt><dd>Moonshot International</dd></div><div><dt>{t('Địa chỉ dịch vụ')}</dt><dd>https://api.moonshot.ai/v1</dd></div><div><dt>{t('Mô hình')}</dt><dd>{status?.model || t('Chưa cấu hình')}</dd></div></dl>
    <div className="setting-note"><ShieldCheck size={15} />{t('Khóa API chỉ được lưu trên máy chủ. Không nhập hoặc hiển thị khóa trong trình duyệt.')}</div>
    {status && !status.configured && <p className="connection-blocker">{t('Quản trị viên cần cấu hình Kimi trên máy chủ để bật chức năng này. Hiện chưa thể gửi yêu cầu trích xuất.')}</p>}
    {error && <p className="connection-blocker" role="alert">{translateSystemText(error, locale)}</p>}
  </section>;
}

export function KimiReviewButton({ document, caseId, revision, initialPage, disabled, onBusyChange, onApplied, onConflict }: {
  document: ShipmentDocument; caseId: string; revision: number; initialPage: number; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onApplied: (response: WorkspaceResponse, message: string) => void; onConflict: (response: WorkspaceResponse) => void;
}) {
  const { t } = useLocale(); const [open, setOpen] = useState(false);
  return <><button className="button secondary small ai-source-button" disabled={disabled || !document.pages.some(page => page.text.trim())} onClick={() => setOpen(true)} title={t('Xem dữ liệu và nơi nhận trước khi yêu cầu Kimi tạo đề xuất')}><Sparkles size={13} />{t('Đề xuất bằng Kimi')}</button>{open && <KimiRequestDialog document={document} caseId={caseId} revision={revision} initialPage={initialPage} onClose={() => setOpen(false)} onBusyChange={onBusyChange} onApplied={onApplied} onConflict={onConflict} />}</>;
}

function KimiRequestDialog({ document, caseId, revision, initialPage, onClose, onBusyChange, onApplied, onConflict }: {
  document: ShipmentDocument; caseId: string; revision: number; initialPage: number; onClose: () => void;
  onBusyChange: (busy: boolean) => void; onApplied: (response: WorkspaceResponse, message: string) => void; onConflict: (response: WorkspaceResponse) => void;
}) {
  const { t, locale } = useLocale(); const { status, error: statusError } = useAiStatus();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pages, setPages] = useState<number[]>(() => {
    const selected = document.pages.find(page => page.page === initialPage && page.text.trim()) || document.pages.find(page => page.text.trim());
    return selected ? [selected.page] : [];
  });
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const selection = selectedAiPages(document, pages, status?.limits || { maxPages: 5, maxTextCharacters: 24000, maxCandidates: 100 });
  const submit = async () => {
    if (pending || !status?.configured || selection.error) return;
    setPending(true); setError(''); onBusyChange(true);
    try {
      const response = await fetchWithSession('/api/ai/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, caseId, documentId: document.id, pages: selection.pages.map(page => page.page), consent: true }) });
      const body = await response.json() as AiResponse;
      if (response.status === 409) { onConflict(body); onClose(); return; }
      if (!response.ok) throw new Error(body.error || 'Kimi chưa tạo được đề xuất. Chưa có thay đổi nào được duyệt.');
      onApplied(body, t('Kimi đã thêm {p0} đề xuất; {p1} mục không đủ căn cứ đã bị loại. Hãy đối chiếu và xác nhận từng giá trị.', { p0: body.ai?.added ?? 0, p1: body.ai?.rejected ?? 0 })); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'Kimi chưa tạo được đề xuất. Chưa có thay đổi nào được duyệt.'); }
    finally { setPending(false); onBusyChange(false); }
  };
  return <dialog ref={dialog} className="modal ai-consent-modal" onCancel={event => { if (pending) event.preventDefault(); else onClose(); }}><div className="modal-header"><div><span className="eyebrow">MOONSHOT INTERNATIONAL</span><h2>{t('Kiểm tra dữ liệu trước khi gửi')}</h2></div><button className="icon-button" aria-label={t('Đóng')} disabled={pending} onClick={onClose}><X size={19} /></button></div>
    <div className="modal-body"><div className="ai-document-summary"><FileText size={21} /><div><strong>{document.name}</strong><small>v{document.version} · {t('Chứng từ nguồn')}</small></div><span className="badge purple">Kimi</span></div>
      <div className="ai-destination"><ArrowUpRight size={17} /><div><strong>{t('Nơi nhận văn bản: Moonshot International')}</strong><span>{status?.endpoint || 'https://api.moonshot.ai/v1'}</span>{status?.model && <small>{t('Mô hình')}: {status.model}</small>}</div></div>
      <p className="ai-disclosure">{t('Chỉ văn bản của các trang bạn chọn bên dưới được gửi đến dịch vụ Kimi quốc tế để tạo đề xuất. Tệp gốc, email gốc và các trang không chọn không được gửi trong yêu cầu này.')}</p>
      <fieldset className="ai-page-selection" disabled={pending}><legend>{t('Chọn trang cần phân tích')}</legend>{document.pages.map(page => <label className="checkbox-label" key={page.page}><input type="checkbox" checked={pages.includes(page.page)} disabled={!page.text.trim()} onChange={event => setPages(current => event.target.checked ? [...current, page.page] : current.filter(number => number !== page.page))} />{t('Trang {p0}', { p0: page.page })}<small>{page.text.trim() ? t('{p0} ký tự', { p0: page.text.length }) : t('Chưa có văn bản')}</small></label>)}</fieldset>
      <div className="ai-selection-summary"><span>{t('{p0} trang · {p1} ký tự', { p0: selection.pages.length, p1: selection.characters })}</span><span>{t('Giới hạn {p0} trang / {p1} ký tự mỗi lần', { p0: status?.limits.maxPages ?? 5, p1: status?.limits.maxTextCharacters ?? 24000 })}</span></div>
      <div className="ai-text-preview">{selection.pages.map(page => <details key={page.page} open><summary>{t('Văn bản sẽ gửi · trang {p0}', { p0: page.page })}</summary><pre>{page.text}</pre></details>)}</div>
      <div className="ai-proposal-note"><CheckCheck size={17} /><p>{t('Kết quả chỉ là đề xuất thông tin đầu hồ sơ có dẫn nguồn; chưa trích xuất dòng hàng bằng Kimi. Không thay chứng từ gốc, không tự duyệt dữ liệu, không gán mã HS hoặc thuế suất.')}</p></div>
      {!status && !statusError && <p className="auth-loading"><Loader2 className="spin" size={15} />{t('Đang kiểm tra cấu hình máy chủ…')}</p>}
      {status && !status.configured && <p className="connection-blocker">{t('Quản trị viên cần cấu hình Kimi trên máy chủ để bật chức năng này. Hiện chưa thể gửi yêu cầu trích xuất.')}</p>}
      {(selection.error || error || statusError) && <div className="inline-form-error" role="alert"><AlertCircle size={16} /><span>{translateSystemText(error || statusError || selection.error || '', locale)}</span></div>}
    </div><div className="modal-footer"><button className="button secondary" disabled={pending} onClick={onClose}>{t('Hủy')}</button><button className="button primary" disabled={pending || !status?.configured || !!selection.error} onClick={() => void submit()}>{pending ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}{t(pending ? 'Đang tạo đề xuất…' : 'Gửi trang đã chọn & tạo đề xuất')}</button></div>
  </dialog>;
}
