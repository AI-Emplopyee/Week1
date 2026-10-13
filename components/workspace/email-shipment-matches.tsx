"use client";

import { useState } from "react";
import { AlertCircle, ArrowUpRight, Check, Loader2, Mail, Sparkles, Upload, X } from "lucide-react";
import { fetchWithSession } from "@/lib/auth-client";
import { currentEmailCaseId, emailLinkedToCase, isEmailMatchCurrent } from "@/lib/email-grouping";
import { useLocale } from "@/lib/i18n";
import { fieldLabel, translateSystemText } from "@/lib/i18n-core";
import type { Action, EmailRecord, EmailShipmentMatch, WorkspaceResponse, WorkspaceState } from "@/lib/types";
import { Badge } from "./shared";

type Props = {
  state: WorkspaceState;
  disabled: boolean;
  mutation: (action: Action, success?: string) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  onApplied: (response: WorkspaceResponse, message: string) => void;
  onConflict: (response: WorkspaceResponse) => void;
  onOpen: (caseId: string) => void;
  onUpload: () => void;
};

type GroupingResponse = WorkspaceResponse & {
  error?: string;
  grouping?: { processedIds?: string[]; omittedEmailIds?: string[]; truncated?: boolean };
};

function linkedCases(state: WorkspaceState, email: EmailRecord) {
  return state.cases.filter(shipment => !shipment.mergedInto && emailLinkedToCase(state, email, shipment.id));
}

/** These are source excerpts, never HTML supplied by the email or model. */
export function EmailMatchEvidence({ state, match }: { state: WorkspaceState; match: EmailShipmentMatch }) {
  const { t, locale } = useLocale();
  return <details className="email-match-evidence">
    <summary>{t("Căn cứ đối chiếu")}</summary>
    <p>{translateSystemText(match.reason, locale)}</p>
    <ul>{match.evidence.map((evidence, index) => {
      const document = state.documents.find(document => document.id === evidence.documentId);
      return <li key={`${evidence.documentId}:${evidence.field}:${index}`}>
        <strong>{fieldLabel(evidence.field, locale)}: {evidence.value}</strong>
        <blockquote><small>{t("Trong email")}</small><br />{evidence.emailQuote}</blockquote>
        <blockquote>
          <small>{t("Trong chứng từ")} · {document?.name || evidence.documentId} · {t("Trang {p0}", { p0: evidence.page })} · v{evidence.documentVersion}</small>
          <br />{evidence.documentQuote}
        </blockquote>
      </li>;
    })}</ul>
  </details>;
}

export function EmailShipmentMatches({ state, disabled, mutation, onBusyChange, onApplied, onConflict, onOpen, onUpload }: Props) {
  const { t, locale, date } = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const emails = [...state.emails].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
  const matches = emails.flatMap(email => (email.shipmentMatches || []).map(match => ({ email, match })));
  const questions = matches.filter(({ match }) => match.status === "needs_review" && isEmailMatchCurrent(state, match));
  const rejected = matches.filter(({ match }) => match.status === "rejected");
  const linked = emails.filter(email => linkedCases(state, email).length > 0);
  const unmatched = emails.filter(email => !linkedCases(state, email).length && !questions.some(question => question.email.id === email.id));
  const unavailable = disabled || pending;

  const groupEmails = async () => {
    if (unavailable || !emails.length) return;
    setPending(true);
    onBusyChange(true);
    setError("");
    try {
      const response = await fetchWithSession("/api/ai/group-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: state.revision }),
      });
      const body = await response.json() as GroupingResponse;
      if (response.status === 409 && body.state) {
        onConflict(body);
        return;
      }
      if (!response.ok || !body.state) throw new Error(body.error || "Không thể đối chiếu email. Vui lòng thử lại.");
      const confirmed = body.state.emails.filter(email => linkedCases(body.state, email).length > 0).length;
      const remaining = body.state.emails.flatMap(email => email.shipmentMatches || []).filter(match => match.status === "needs_review" && isEmailMatchCurrent(body.state, match)).length;
      const omitted = body.grouping?.omittedEmailIds?.length || 0;
      const summary = t("Đã đối chiếu email. {p0} email đã liên kết; {p1} liên kết cần kiểm tra.", { p0: confirmed, p1: remaining });
      onApplied(body, omitted
        ? `${summary} ${t("Còn {p0} email chưa xử lý trong lần này. Bấm đối chiếu để tiếp tục.", { p0: omitted })}`
        : body.grouping?.truncated
          ? `${summary} ${t("Một số nội dung vượt giới hạn lần đọc này. Kiểm tra email chưa liên kết.")}`
          : summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể đối chiếu email. Vui lòng thử lại.");
    } finally {
      setPending(false);
      onBusyChange(false);
    }
  };

  const emailHeading = (email: EmailRecord) => <>
    <h3>{email.subject || t("(Không có tiêu đề)")}</h3>
    <small>{email.sender} · {date(email.receivedAt)}</small>
  </>;

  return <section className="card email-shipment-matches" aria-label={t("Email theo lô hàng")}>
    <div className="email-matching-heading">
      <div>
        <h2><Mail size={16} /> {t("Email theo lô hàng")}</h2>
        <p>{t("{p0} email · {p1} đã liên kết · {p2} cần kiểm tra", { p0: emails.length, p1: linked.length, p2: questions.length })}</p>
      </div>
      <div className="email-match-actions">
        <button className="button secondary small" disabled={unavailable} onClick={onUpload}><Upload size={14} />{t("Nhập email .eml")}</button>
        <button className="button secondary small" disabled={unavailable || !emails.length} onClick={() => void groupEmails()}>
          {pending ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
          {t(pending ? "Đang đối chiếu email…" : "Đối chiếu email bằng AI")}
        </button>
      </div>
    </div>
    <p className="email-matching-description">{t(emails.length
      ? "AI đối chiếu nội dung email và chứng từ để tìm đúng lô hàng. Chỉ những liên kết chưa chắc chắn mới cần bạn kiểm tra."
      : "Chưa có email được nhập. Nhập tệp .eml để đối chiếu với các lô hàng.")}</p>
    <p className="email-matching-description">{t("Đồng bộ Gmail chưa được triển khai; hiện chỉ xử lý email .eml đã nhập.")}</p>
    {error && <div className="inline-form-error" role="alert"><AlertCircle size={16} /><span>{translateSystemText(error, locale)}</span></div>}
    {pending && <p className="email-matching-description" role="status">{t("Đang đối chiếu email…")}</p>}

    {questions.length > 0 && <div aria-label={t("Kiểm tra liên kết email")}>{questions.map(({ email, match }) => {
      const shipment = state.cases.find(shipment => shipment.id === currentEmailCaseId(state, match.caseId));
      return <article key={`${email.id}:${match.id}`} className="email-match-record">
        {emailHeading(email)}
        <p><strong>{t("Email này thuộc lô hàng {p0}?", { p0: shipment?.reference || match.caseId })}</strong>{shipment?.title && <> · {shipment.title}</>}</p>
        <EmailMatchEvidence state={state} match={match} />
        <div className="email-match-actions">
          <button className="button primary small" disabled={unavailable} onClick={() => void mutation({ type: "review_email_match", emailId: email.id, matchId: match.id, decision: "accept", reason: t("Đã kiểm tra mã lô hàng trong email và chứng từ; xác nhận cùng lô hàng.") }, t("Đã xác nhận liên kết email."))}><Check size={14} />{t("Đúng lô hàng")}</button>
          <button className="button secondary small" disabled={unavailable} onClick={() => void mutation({ type: "review_email_match", emailId: email.id, matchId: match.id, decision: "reject", reason: t("Đã kiểm tra email và chứng từ; liên kết này không đúng lô hàng.") }, t("Đã loại liên kết email này."))}><X size={14} />{t("Không cùng lô hàng")}</button>
          {shipment && <button className="button secondary small" disabled={pending} onClick={() => onOpen(shipment.id)}><ArrowUpRight size={14} />{t("Mở lô hàng")}</button>}
          <a className="button secondary small" href={`/api/emails/${email.id}`} target="_blank" rel="noreferrer">{t("Tải email gốc")}</a>
        </div>
      </article>;
    })}</div>}

    {unmatched.length > 0 && <details className="email-match-history">
      <summary>{t("Email chưa xác định lô hàng ({p0})", { p0: unmatched.length })}</summary>
      {unmatched.map(email => <article className="email-match-record" key={email.id}>
        {emailHeading(email)}
        <p>{t("Chưa đủ căn cứ để tự liên kết. Kiểm tra nội dung email và các chứng từ liên quan.")}</p>
        {email.aiGroupingError && <p className="muted">{translateSystemText(email.aiGroupingError, locale)}</p>}
        {email.text && <details className="email-match-evidence"><summary>{t("Nội dung email")}</summary><div className="email-body-text">{email.text}</div></details>}
        <a className="button secondary small" href={`/api/emails/${email.id}`} target="_blank" rel="noreferrer">{t("Tải email gốc")}</a>
      </article>)}
    </details>}

    {linked.length > 0 && <details className="email-match-history">
      <summary>{t("Email đã liên kết ({p0})", { p0: linked.length })}</summary>
      {linked.map(email => <article className="email-match-record" key={email.id}>
        {emailHeading(email)}
        <div className="email-match-actions">{linkedCases(state, email).map(shipment => <button className="button secondary small" key={shipment.id} disabled={pending} onClick={() => onOpen(shipment.id)}><ArrowUpRight size={14} />{shipment.reference} · {shipment.title}</button>)}</div>
        {(email.shipmentMatches || []).filter(match => match.status === "matched" && isEmailMatchCurrent(state, match)).map(match => <EmailMatchEvidence key={match.id} state={state} match={match} />)}
      </article>)}
    </details>}

    {rejected.length > 0 && <details className="email-match-history">
      <summary>{t("Liên kết đã loại ({p0})", { p0: rejected.length })}</summary>
      {rejected.map(({ email, match }) => <article className="email-match-record" key={`${email.id}:${match.id}`}>
        {emailHeading(email)}
        <p><Badge>{t("Không cùng lô hàng")}</Badge> {state.cases.find(shipment => shipment.id === match.caseId)?.reference || match.caseId} · {date(match.updatedAt)}</p>
        <EmailMatchEvidence state={state} match={match} />
      </article>)}
    </details>}
  </section>;
}
