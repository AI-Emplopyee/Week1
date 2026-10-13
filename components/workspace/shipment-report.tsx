"use client";
import { FIELD_DEFINITIONS } from "@/lib/engine";
import { useLocale } from "@/lib/i18n";
import { translateSystemText } from "@/lib/i18n-core";
import type { Issue, ShipmentCase, WorkspaceState } from "@/lib/types";
import { AlertCircle, ArrowUpRight, FileText, ShieldCheck } from "lucide-react";
import React from "react";
import { AuditList } from "./audit-list";
import { STATUS, activeDocs, documentLabel, proposed } from "./shared";
type Props = { state: WorkspaceState; shipment: ShipmentCase; issues: Issue[] };
export function ShipmentReport({
  state,
  shipment: current,
  issues: caseIssues,
}: Props) {
  const { t, locale } = useLocale();
  const documents = activeDocs(state, current.id);
  const currentCandidates = state.candidates.filter(
    (c) =>
      c.caseId === current.id &&
      documents.some(
        (d) => d.id === c.documentId && d.version === c.documentVersion,
      ),
  );
  return (
    <section className="report-wrap">
      <div className="report-cover">
        <span className="eyebrow">{t("BÁO CÁO TRƯỚC KHI NỘP")}</span>
        <h2>
          {current.reference} · {current.title}
        </h2>
        <p>
          {t(
            "Chứng từ nguồn, quyết định rà soát và các bước còn lại trong một báo cáo.",
          )}
        </p>
        <div className="report-statuses">
          <div>
            <small>{t("Trạng thái AICD")}</small>
            <strong>{t(STATUS[current.status])}</strong>
          </div>
          <div>
            <small>{t("Vấn đề còn lại")}</small>
            <strong>{caseIssues.length}</strong>
          </div>
          <div>
            <small>{t("Kiểm tra quy định")}</small>
            <strong>{t("Chưa đánh giá")}</strong>
          </div>
          <div>
            <small>{t("Phiên bản được duyệt")}</small>
            <strong>
              {current.approval?.snapshotId || t("Chưa được đóng băng")}
            </strong>
          </div>
        </div>
      </div>
      <div className="report-columns">
        <ReportSection title={t("01 / Dữ kiện và quyết định rà soát")}>
          <dl className="report-fields">
            {FIELD_DEFINITIONS.map((field) => (
              <div key={field.key}>
                <dt>{t(field.label)}</dt>
                <dd>
                  {proposed(state, current, field.key) || t("Chưa có dữ liệu")}
                  <small>
                    {current.fields[field.key]?.stale
                      ? t("Nguồn đã thay đổi · cần rà soát lại")
                      : current.fields[field.key]
                        ? `${current.fields[field.key].source === "manual" ? t("Nhập tay / chưa xác minh") : t("Người rà soát xác nhận")} · ${current.fields[field.key].reviewedBy}`
                        : t("Dữ kiện đề xuất từ chứng từ")}
                  </small>
                  <small>
                    {currentCandidates
                      .filter((v) => v.field === field.key && !v.lineId)
                      .map(
                        (v) =>
                          `${state.documents.find((d) => d.id === v.documentId)?.name || t("Chứng từ")} · ${t("tr.")} ${v.page}`,
                      )
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join("; ")}
                  </small>
                  {current.fields[field.key]?.reason && (
                    <small>
                      {t("Căn cứ: ")}
                      {current.fields[field.key].reason}
                    </small>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </ReportSection>
        <div>
          <ReportSection title={t("02 / Việc cần làm")}>
            {caseIssues.length ? (
              caseIssues.map((i) => (
                <div className="report-issue" key={i.id}>
                  <AlertCircle size={16} />
                  <div>
                    <strong>{i.title}</strong>
                    <p>{i.description}</p>
                  </div>
                </div>
              ))
            ) : (
              <p>
                {t(
                  "Các vấn đề dữ liệu đã được xử lý. Cần chuyên viên đánh giá quy định và các quyết định hải quan.",
                )}
              </p>
            )}
          </ReportSection>
          <ReportSection title={t("03 / Chứng từ đã nhận")}>
            {documents.map((d) => (
              <div className="report-document" key={d.id}>
                <FileText size={17} />
                <span>
                  <strong>{d.name}</strong>
                  <small>
                    {t(documentLabel(d.type))} · v{d.version} · {d.pages.length}{" "}
                    {t("trang")}
                  </small>
                </span>
                <a
                  href={`/api/documents/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("Mở {p0}", { p0: d.name })}
                >
                  <ArrowUpRight size={15} />
                </a>
              </div>
            ))}
          </ReportSection>
          <ReportSection title={t("04 / Chuẩn hóa tự động")}>
            {currentCandidates.some((c) => c.normalizations.length) ? (
              currentCandidates.flatMap((c) =>
                c.normalizations.map((n, i) => (
                  <div
                    className="normalization report-normalization"
                    key={`${c.id}-${i}`}
                  >
                    <strong>
                      {n.before} → {n.after}
                    </strong>
                    <span>{translateSystemText(n.reason, locale)}</span>
                    <small>
                      {state.documents.find((d) => d.id === c.documentId)?.name}{" "}
                      · {t("tr.")} {c.page}
                    </small>
                  </div>
                )),
              )
            ) : (
              <p>{t("Không có chuẩn hóa tự động được ghi nhận.")}</p>
            )}
          </ReportSection>
        </div>
      </div>
      <ReportSection title={t("05 / Nhật ký quyết định: trước và sau")}>
        <AuditList
          entries={state.audit
            .filter(
              (a) =>
                a.caseId === current.id &&
                [
                  "review_field",
                  "review_goods",
                  "resolve_issue",
                  "field_reviewed",
                  "goods_reviewed",
                  "issue_resolved",
                ].includes(a.action),
            )
            .slice()
            .reverse()}
        />
      </ReportSection>
      <div className="report-disclaimer">
        <ShieldCheck size={19} />
        <p>
          <strong>
            {t("Kiểm tra phần mềm không thay thế đánh giá hải quan.")}
          </strong>{" "}
          {t(
            "Quy tắc pháp lý, bảng mã và tính thuế chưa được triển khai. Báo cáo không chứng nhận tuân thủ hay được hải quan chấp thuận.",
          )}
        </p>
      </div>
    </section>
  );
}
function ReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
