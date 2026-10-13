"use client";

import { useLocale } from "@/lib/i18n";
import { currentEmailCaseId, emailLinkedToCase, isEmailMatchCurrent } from "@/lib/email-grouping";
import type { Action, ShipmentCase, WorkspaceState } from "@/lib/types";
import { ArrowDownToLine, FileText, Mail, Save, Upload } from "lucide-react";
import { useState } from "react";
import { Badge, Empty, documentLabel } from "./shared";
import { EmailMatchEvidence } from "./email-shipment-matches";

export type EmailDraftEdit = { subject: string; body: string };
type Props = {
  state: WorkspaceState;
  shipment: ShipmentCase;
  disabled: boolean;
  onUpload: () => void;
  onDocument: (documentId: string) => void;
  mutation: (action: Action, success?: string) => Promise<boolean>;
  edits: Record<string, EmailDraftEdit>;
  onEdit: (id: string, edit: EmailDraftEdit) => void;
  onSaved: (id: string, edit: EmailDraftEdit) => void;
};

export function ShipmentMessages({
  state,
  shipment,
  disabled,
  onUpload,
  onDocument,
  mutation,
  edits,
  onEdit,
  onSaved,
}: Props) {
  const { t, date } = useLocale();
  const [selectedId, setSelectedId] = useState("");
  const documents = state.documents.filter(
    (document) => document.caseId === shipment.id,
  );
  const messages = state.emails.filter((email) => emailLinkedToCase(state, email, shipment.id));
  const drafts = (state.emailDrafts || [])
    .filter((draft) => draft.caseId === shipment.id)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const selected =
    messages.find((email) => email.id === selectedId) || messages[0];

  return (
    <section className="shipment-messages">
      <div className="email-notice">
        <Mail size={23} />
        <div>
          <strong>
            Google Workspace / Gmail{" "}
            <Badge tone="amber">{t("Chưa kết nối")}</Badge>
          </strong>
          <p>
            {t(
              "Email đã nhập được đối chiếu với lô hàng bằng chứng từ và nội dung trao đổi. Đồng bộ Gmail và gửi tin nhắn chưa được triển khai.",
            )}
          </p>
        </div>
        <button
          className="button secondary small"
          disabled={disabled}
          onClick={onUpload}
        >
          <Upload size={15} />
          {t("Nhập email .eml")}
        </button>
      </div>
      {drafts.length > 0 && (
        <section
          className="card email-drafts"
          aria-label={t("Email nháp hỏi người gửi")}
        >
          <div className="panel-heading">
            <h2>{t("Email nháp hỏi người gửi")}</h2>
            <Badge>{drafts.length}</Badge>
          </div>
          <p className="email-draft-notice">
            {t(
              "Kiểm tra và chỉnh sửa câu hỏi trước khi gửi. Bản nháp chỉ lưu trên AICD; chưa gửi email.",
            )}
          </p>
          {drafts.map((draft) => {
            const value = edits[draft.id] || draft;
            const changed =
              value.subject !== draft.subject || value.body !== draft.body;
            return (
              <article className="email-draft" key={draft.id}>
                <div className="email-draft-meta">
                  <span>
                    {t("Người nhận")}:{" "}
                    <strong>
                      {draft.recipient || t("Chưa có email người gửi")}
                    </strong>
                  </span>
                  <Badge tone={changed ? "amber" : "neutral"}>
                    {t(changed ? "Có thay đổi chưa lưu" : "Bản nháp đã lưu")}
                  </Badge>
                </div>
                {!draft.recipient && (
                  <p className="muted">
                    {t(
                      "Tệp tải lên không có địa chỉ người gửi. Chưa xác định người nhận email.",
                    )}
                  </p>
                )}
                <label htmlFor={`email-subject-${draft.id}`}>
                  {t("Tiêu đề")}
                </label>
                <input
                  id={`email-subject-${draft.id}`}
                  value={value.subject}
                  disabled={disabled}
                  onChange={(event) =>
                    onEdit(draft.id, {
                      subject: event.target.value,
                      body: value.body,
                    })
                  }
                />
                <label htmlFor={`email-body-${draft.id}`}>
                  {t("Nội dung câu hỏi")}
                </label>
                <textarea
                  id={`email-body-${draft.id}`}
                  value={value.body}
                  rows={9}
                  disabled={disabled}
                  onChange={(event) =>
                    onEdit(draft.id, {
                      subject: value.subject,
                      body: event.target.value,
                    })
                  }
                />
                <div className="email-draft-footer">
                  <small>{date(draft.updatedAt)}</small>
                  <button
                    className="button primary small"
                    disabled={
                      disabled ||
                      !changed ||
                      !value.subject.trim() ||
                      !value.body.trim()
                    }
                    onClick={async () => {
                      const submitted = {
                        subject: value.subject,
                        body: value.body,
                      };
                      if (
                        await mutation(
                          {
                            type: "save_email_draft",
                            draftId: draft.id,
                            ...submitted,
                          },
                          t("Đã lưu email nháp. Chưa gửi email."),
                        )
                      )
                        onSaved(draft.id, submitted);
                    }}
                  >
                    <Save size={14} />
                    {t("Lưu email nháp")}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
      <div className="card email-layout">
        <div className="email-list">
          <div className="panel-heading">
            <h2>{t("Email đã tiếp nhận")}</h2>
            <Badge>{messages.length}</Badge>
          </div>
          {messages.map((email) => (
            <button
              key={email.id}
              className={`email-row ${selected?.id === email.id ? "selected" : ""}`}
              onClick={() => setSelectedId(email.id)}
            >
              <span className="email-sender">
                <Mail size={15} />
                {email.sender}
              </span>
              <strong>{email.subject || t("(Không có tiêu đề)")}</strong>
              <small>{date(email.receivedAt)}</small>
            </button>
          ))}
          {!messages.length && (
            <Empty icon={Mail} title={t("Chưa có email cho lô hàng này")}>
              <p>
                {t(
                  "Nhập email .eml cùng tệp đính kèm để giữ lại nguồn trao đổi.",
                )}
              </p>
            </Empty>
          )}
        </div>
        <div className="email-detail">
          {selected ? (
            <>
              <Badge>{t("Email gốc được bảo toàn")}</Badge>
              <h2>{selected.subject || t("(Không có tiêu đề)")}</h2>
              <dl>
                <dt>{t("Người gửi")}</dt>
                <dd>{selected.sender}</dd>
                <dt>{t("Thời điểm")}</dt>
                <dd>{date(selected.receivedAt)}</dd>
                <dt>Message-ID</dt>
                <dd>{selected.messageId}</dd>
                <dt>{t("Tệp gốc")}</dt>
                <dd>{selected.originalName}</dd>
              </dl>
              {(selected.shipmentMatches || [])
                .filter(match => currentEmailCaseId(state, match.caseId) === shipment.id && match.status === "matched" && isEmailMatchCurrent(state, match))
                .map(match => <EmailMatchEvidence key={match.id} state={state} match={match} />)}
              <a
                className="button secondary"
                href={`/api/emails/${selected.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <ArrowDownToLine size={15} />
                {t("Tải email gốc")}
              </a>
              {selected.text ? (
                <>
                  <h3>{t("Nội dung email")}</h3>
                  <div className="email-body-text">{selected.text}</div>
                </>
              ) : (
                <p className="muted">
                  {t("Chưa có văn bản email để hiển thị. Tải email gốc để xem nội dung.")}
                </p>
              )}
              <h3>{t("Tệp đính kèm của lô hàng")}</h3>
              {documents
                .filter(
                  (document) =>
                    selected.documentIds.includes(document.id) ||
                    document.sourceEmailId === selected.id,
                )
                .map((document) => (
                  <button
                    key={document.id}
                    className="email-attachment"
                    onClick={() => onDocument(document.id)}
                  >
                    <FileText size={19} />
                    <span>
                      <strong>{document.name}</strong>
                      <small>
                        {t(documentLabel(document.type))} · v{document.version}
                      </small>
                    </span>
                  </button>
                ))}
            </>
          ) : (
            <Empty icon={Mail} title={t("Trao đổi gắn với chứng từ")}>
              <p>
                {t(
                  "Người gửi, thời điểm và chứng từ gốc luôn có thể truy xuất.",
                )}
              </p>
            </Empty>
          )}
        </div>
      </div>
    </section>
  );
}
