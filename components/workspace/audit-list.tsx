"use client";
import { useLocale } from "@/lib/i18n";
import {
  auditActionLabel,
  fieldLabel,
  translateSystemText,
} from "@/lib/i18n-core";
import type { WorkspaceState } from "@/lib/types";
import { History } from "lucide-react";
import { Empty } from "./shared";
export function AuditList({ entries }: { entries: WorkspaceState["audit"] }) {
  const { locale, t, date } = useLocale();
  return entries.length ? (
    <div className="audit-list">
      {entries.map((a) => (
        <div className="audit-entry" key={a.id}>
          <span className="audit-marker">
            <History size={14} />
          </span>
          <div>
            <div className="audit-entry-heading">
              <strong>
                {auditActionLabel(a.action, locale)}
                {a.field && ` · ${fieldLabel(a.field, locale)}`}
              </strong>
              <time>{date(a.at)}</time>
            </div>
            <p>
              {[
                "field_reviewed",
                "goods_reviewed",
                "issue_resolved",
                "case_reopened",
                "case_completed",
                "declaration_field_saved",
                "declaration_field_reviewed",
                "declaration_field_removed",
              ].includes(a.action)
                ? a.reason
                : translateSystemText(a.reason, locale)}
            </p>
            <small>{a.actor}</small>
            {(a.before !== undefined || a.after !== undefined) && (
              <details>
                <summary>{t("Xem giá trị trước và sau")}</summary>
                <div className="audit-comparison">
                  <div>
                    <span>{t("TRƯỚC")}</span>
                    <pre>
                      {typeof a.before === "string"
                        ? a.before
                        : JSON.stringify(a.before ?? "—", null, 2)}
                    </pre>
                  </div>
                  <div>
                    <span>{t("SAU")}</span>
                    <pre>
                      {typeof a.after === "string"
                        ? a.after
                        : JSON.stringify(a.after ?? "—", null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty icon={History} title={t("Chưa có thay đổi được ghi nhận")} />
  );
}
