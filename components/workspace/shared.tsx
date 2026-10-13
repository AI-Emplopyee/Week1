import { DOCUMENT_LABELS } from "@/lib/engine";
import type { DocumentType, ShipmentCase, WorkspaceState } from "@/lib/types";
import { Inbox } from "lucide-react";
import React from "react";
export const STATUS = {
  review: "Đang rà soát",
  approved: "Đã duyệt nội bộ",
  completed: "Đã hoàn tất",
};
export const confidenceLabel = {
  high: "Độ tin cậy cao",
  medium: "Cần kiểm tra",
  low: "Chưa chắc chắn",
};
export const initials = (value: string) =>
  value
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0])
    .join("")
    .toUpperCase();
export const activeDocs = (state: WorkspaceState, caseId: string) =>
  state.documents.filter((d) => d.caseId === caseId && d.active);
export const proposed = (
  state: WorkspaceState,
  c: ShipmentCase,
  key: string,
) => {
  const reviewed = c.fields[key];
  if (reviewed && !reviewed.stale) return reviewed.value;
  const values = [
    ...new Set(
      state.candidates
        .filter(
          (v) =>
            v.caseId === c.id &&
            v.field === key &&
            !v.lineId &&
            state.documents.some(
              (d) =>
                d.id === v.documentId &&
                d.active &&
                d.version === v.documentVersion,
            ),
        )
        .map((v) => v.value),
    ),
  ];
  return values.length === 1 ? values[0] : "";
};

export const documentLabel = (type: DocumentType): string =>
  DOCUMENT_LABELS[type] || type;
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  icon: Icon = Inbox,
  title,
  children,
}: {
  icon?: typeof Inbox;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}
