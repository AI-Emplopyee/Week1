"use client";

import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  FileText,
  List,
  Loader2,
  LockKeyhole,
  Plus,
  Save,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  Action,
  Candidate,
  Issue,
  ShipmentCase,
  ShipmentDocument,
  WorkspaceState,
} from "@/lib/types";
import type {
  DeclarationCatalogField,
  DeclarationComponent,
  DeclarationFieldEntry,
  DeclarationProvenance,
  DeclarationValue,
  SaveDeclarationFieldAction,
} from "@/lib/declaration-types";
import {
  DECLARATION_FIELDS,
  getDeclarationField,
} from "@/lib/declaration-catalog";
import {
  DECLARATION_LIMITS,
  declarationEntryKey,
  emptyDeclarationValue,
  getDeclarationEntry,
  getDeclarationCoverage,
  isDeclarationSourceCurrent,
  newDeclarationRow,
  validateDeclarationEntry,
} from "@/lib/declaration";
import { VisionEvidenceImage } from "@/components/vision-evidence-image";
import { caseScopeMessage } from "@/lib/case-scope";
import { declarationDraftKey } from "@/lib/declaration-client";
import { VNACCS_FIELDS, VNACCS_SOURCES } from "@/lib/vnaccs";
import { useLocale } from "@/lib/i18n";
import { translateIssue, translateSystemText } from "@/lib/i18n-core";

export type DeclarationUiDraft = Pick<
  SaveDeclarationFieldAction,
  "applicability" | "basis" | "value" | "provenance" | "reason"
>;
type Props = {
  state: WorkspaceState;
  shipment: ShipmentCase;
  issues: Issue[];
  busy: boolean;
  drafts: Record<string, DeclarationUiDraft>;
  onChange: (key: string, draft: DeclarationUiDraft) => void;
  onSaved: (key: string, submitted: DeclarationUiDraft) => void;
  mutation: (action: Action, success?: string) => Promise<boolean>;
  onManageGoods: () => void;

  focusFieldId?: string;
  focusGoodsLineId?: string;
};
type EditorTab = "general_1" | "general_2" | "goods";
const TAB_LABELS = {
  general_1: "Thông tin chung 1",
  general_2: "Thông tin chung 2",
  goods: "Danh sách hàng",
} as const;

function entryStatus(
  entry: DeclarationFieldEntry | undefined,
  dirty = false,
): string {
  return dirty
    ? "Có thay đổi chưa lưu"
    : entry?.stale
      ? "Nguồn thay đổi · cần rà soát"
      : entry?.review
        ? "Đã rà soát nội bộ"
        : entry
          ? "Bản nháp đã lưu"
          : "Chưa nhập";
}
function fromEntry(
  field: DeclarationCatalogField,
  entry?: DeclarationFieldEntry,
): DeclarationUiDraft {
  return {
    applicability: entry?.applicability || "unresolved",
    basis: entry?.basis || "",
    value: entry?.value || emptyDeclarationValue(field.id),
    provenance: entry?.provenance || [],
    reason: "",
  };
}

function StructuredValueEditor({
  field,
  value,
  shipment,
  goodsLineId,
  disabled,
  onChange,
}: {
  field: DeclarationCatalogField;
  value: DeclarationValue;
  shipment: ShipmentCase;
  goodsLineId?: string;
  disabled: boolean;
  onChange: (value: DeclarationValue) => void;
}) {
  const { locale, t } = useLocale();
  const control = (
    component: DeclarationComponent,
    record: Record<string, unknown>,
    update: (key: string, value: string) => void,
    suffix: string,
  ) => {
    const label = locale === "en" ? component.labelEn : component.labelVi;
    const id = `declaration-${field.id}-${suffix}-${component.key}`;
    const content =
      typeof record[component.key] === "string"
        ? (record[component.key] as string)
        : "";
    let referenceRows: { id: string; text: string }[] = [];
    if (component.input === "row_reference" && component.referenceFieldId) {
      const targetField = getDeclarationField(component.referenceFieldId);
      const related = getDeclarationEntry(
        shipment.declarationDraft,
        component.referenceFieldId,
        targetField?.scope === "item" ? goodsLineId : undefined,
      );
      if (related && "rows" in related.value)
        referenceRows = related.value.rows.map((row, index) => ({
          id: row.id,
          text: `${index + 1} · ${
            Object.entries(row)
              .filter(
                ([key, value]) =>
                  key !== "id" && typeof value === "string" && value,
              )
              .map(([, value]) => value)
              .join(" · ") || row.id
          }`,
        }));
    }
    return (
      <label
        className={`declaration-control ${component.input === "long_text" ? "full" : ""}`}
        key={component.key}
        htmlFor={id}
      >
        <span>{label}</span>
        {component.input === "long_text" ? (
          <textarea
            id={id}
            rows={4}
            value={content}
            disabled={disabled}
            onChange={(event) => update(component.key, event.target.value)}
          />
        ) : component.input === "row_reference" ? (
          <select
            id={id}
            disabled={disabled}
            value={content}
            onChange={(event) => update(component.key, event.target.value)}
          >
            <option value="">{t("Chọn dòng đã lưu")}</option>
            {content && !referenceRows.some((row) => row.id === content) && (
              <option value={content}>
                {t("Liên kết cần kiểm tra")}: {content}
              </option>
            )}
            {referenceRows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.text}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type={
              component.input === "date"
                ? "date"
                : component.input === "integer" || component.input === "year"
                  ? "number"
                  : "text"
            }
            inputMode={
              component.input === "decimal"
                ? "decimal"
                : component.input === "integer" || component.input === "year"
                  ? "numeric"
                  : undefined
            }
            step={
              component.input === "integer" || component.input === "year"
                ? 1
                : undefined
            }
            min={component.nonNegative ? 0 : undefined}
            value={content}
            disabled={disabled}
            autoComplete="off"
            spellCheck={component.input === "code" ? false : undefined}
            onChange={(event) => update(component.key, event.target.value)}
          />
        )}
        {component.input === "code" && (
          <small>{t("Mã nhập tay · danh mục hiện hành chưa xác minh")}</small>
        )}
        {component.input === "row_reference" && (
          <small>
            {t("Liên kết bằng ID ổn định của dòng, không theo số thứ tự.")}
          </small>
        )}
      </label>
    );
  };
  if ("rows" in value) {
    const rows = value.rows as unknown as Record<string, unknown>[];
    const replaceRows = (next: Record<string, unknown>[]) =>
      onChange({ ...value, rows: next } as DeclarationValue);
    return (
      <div className="declaration-repeated">
        {rows.map((row, index) => (
          <div className="declaration-repeating-row" key={String(row.id)}>
            <div className="declaration-row-heading">
              <span>{t("Dòng {p0}", { p0: index + 1 })}</span>
              <button
                type="button"
                className="icon-button"
                disabled={disabled}
                aria-label={t("Bỏ dòng {p0}", { p0: index + 1 })}
                onClick={() =>
                  replaceRows(rows.filter((item) => item.id !== row.id))
                }
              >
                <X size={14} />
              </button>
            </div>
            <div className="declaration-control-grid">
              {field.components.map((component) =>
                control(
                  component,
                  row,
                  (key, input) =>
                    replaceRows(
                      rows.map((item) =>
                        item.id === row.id ? { ...item, [key]: input } : item,
                      ),
                    ),
                  String(row.id),
                ),
              )}
            </div>
          </div>
        ))}
        {!rows.length && (
          <p className="muted">
            {t("Chưa có dòng. Thêm các mục thực tế áp dụng cho hồ sơ.")}
          </p>
        )}
        <button
          className="button secondary small"
          disabled={disabled || rows.length >= DECLARATION_LIMITS.maxRows}
          onClick={() => replaceRows([...rows, newDeclarationRow(field.id)])}
        >
          <Plus size={13} />
          {t("Thêm dòng")}
        </button>
      </div>
    );
  }
  return (
    <div className="declaration-control-grid">
      {field.components.map((component) =>
        control(
          component,
          value as unknown as Record<string, unknown>,
          (key, input) =>
            onChange({ ...value, [key]: input } as DeclarationValue),
          "value",
        ),
      )}
    </div>
  );
}

function EvidenceEditor({
  provenance,
  documents,
  candidates,
  caseId,
  disabled,
  onChange,
}: {
  provenance: DeclarationProvenance[];
  documents: ShipmentDocument[];
  candidates: Candidate[];
  caseId: string;
  disabled: boolean;
  onChange: (value: DeclarationProvenance[]) => void;
}) {
  const { t, locale } = useLocale();
  const update = (index: number, next: DeclarationProvenance) =>
    onChange(provenance.map((entry, at) => (at === index ? next : entry)));
  const addDocument = () => {
    const document = documents.find((document) => document.pages.length);
    if (document)
      onChange([
        ...provenance,
        {
          kind: "document",
          documentId: document.id,
          documentVersion: document.version,
          page: document.pages[0].page,
          quote: "",
        },
      ]);
  };
  return (
    <>
      <div className="declaration-evidence-list">
        {provenance.map((source, index) => {
          const document =
            source.kind === "document"
              ? documents.find(
                  (document) =>
                    document.id === source.documentId &&
                    document.version === source.documentVersion,
                )
              : undefined;
          const page =
            source.kind === "document"
              ? document?.pages.find((page) => page.page === source.page)
              : undefined;
          const exactQuote =
            source.kind === "document" &&
            isDeclarationSourceCurrent(source, { caseId, documents, candidates, goods: [] });
          return (
            <div className="declaration-evidence-card" key={index}>
              <FileText size={15} />
              <div>
                {source.kind === "manual" ? (
                  <label className="declaration-control">
                    <span>{t("Căn cứ nhập tay / quyết định nghiệp vụ")}</span>
                    <textarea
                      rows={3}
                      disabled={disabled}
                      value={source.note}
                      onChange={(event) =>
                        update(index, {
                          kind: "manual",
                          note: event.target.value,
                        })
                      }
                      placeholder={t(
                        "Nêu tài liệu, người xác nhận hoặc căn cứ của quyết định.",
                      )}
                    />
                  </label>
                ) : (
                  <>
                    <div className="declaration-control-grid">
                      <label className="declaration-control">
                        <span>{t("Chứng từ")}</span>
                        <select
                          disabled={disabled || !!source.visualEvidence}
                          value={source.documentId}
                          onChange={(event) => {
                            const next = documents.find(
                              (document) => document.id === event.target.value,
                            );
                            if (next)
                              update(index, {
                                ...source,
                                documentId: next.id,
                                documentVersion: next.version,
                                page: next.pages[0]?.page || 1,
                              });
                          }}
                        >
                          {!document && (
                            <option value={source.documentId}>
                              {t("Phiên bản nguồn không còn hoạt động")}
                            </option>
                          )}
                          {documents
                            .filter((document) => document.pages.length)
                            .map((document) => (
                              <option key={document.id} value={document.id}>
                                {document.name} · v{document.version}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="declaration-control">
                        <span>{t("Trang nguồn")}</span>
                        <select
                          disabled={disabled || !document || !!source.visualEvidence}
                          value={source.page}
                          onChange={(event) =>
                            update(index, {
                              ...source,
                              page: Number(event.target.value),
                            })
                          }
                        >
                          {document?.pages.map((page) => (
                            <option key={page.page} value={page.page}>
                              {t("Trang {p0}", { p0: page.page })}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="declaration-control full">
                        <span>{source.visualEvidence ? (locale === "vi" ? "Nội dung AI đọc từ ảnh" : "AI image transcript") : t("Trích nguyên văn làm bằng chứng")}</span>
                        <textarea
                          rows={3}
                          disabled={disabled || !!source.visualEvidence}
                          value={source.quote}
                          onChange={(event) =>
                            update(index, {
                              ...source,
                              quote: event.target.value,
                            })
                          }
                          placeholder={t(
                            "Sao chép đúng đoạn văn từ trang nguồn bên dưới.",
                          )}
                        />
                        <small
                          className={exactQuote ? "text-green" : "text-amber"}
                        >
                          {source.visualEvidence
                            ? (locale === "vi" ? (exactQuote ? "Liên kết đúng bằng chứng ảnh đã lưu; chưa tự xác nhận độ chính xác." : "Bằng chứng ảnh đã thay đổi hoặc không còn khả dụng.") : (exactQuote ? "Linked to saved image evidence; accuracy is not automatically approved." : "The image evidence changed or is no longer available."))
                            : t(exactQuote ? "Đoạn trích khớp nguyên văn với trang nguồn." : "Cần đoạn trích nguyên văn đúng phiên bản và trang.")}

                        </small>
                      </label>
                    </div>
                    {document && source.visualEvidence && exactQuote && <VisionEvidenceImage documentId={document.id} page={source.page} evidence={source.visualEvidence} />}
                    {document && (
                      <details className="declaration-context">
                        <summary>
                          {t("Xem văn bản nguồn")} · {document.name} · v
                          {document.version} · {source.page}
                        </summary>
                        <a
                          className="declaration-coverage-link"
                          href={`/api/documents/${document.id}#page=${source.page}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("Mở chứng từ gốc")}
                          <ArrowUpRight size={12} />
                        </a>
                        <pre>{page?.text || t("Chưa có văn bản")}</pre>
                      </details>
                    )}
                  </>
                )}
              </div>
              <button
                className="icon-button"
                disabled={disabled}
                aria-label={t("Bỏ nguồn {p0}", { p0: index + 1 })}
                onClick={() =>
                  onChange(provenance.filter((_, at) => at !== index))
                }
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="declaration-evidence-actions">
        <button
          className="button secondary small"
          disabled={
            disabled ||
            provenance.length >= DECLARATION_LIMITS.maxProvenance ||
            !documents.some((document) => document.pages.length)
          }
          onClick={addDocument}
        >
          <Plus size={13} />
          {t("Thêm nguồn chứng từ")}
        </button>
        <button
          className="button secondary small"
          disabled={
            disabled || provenance.length >= DECLARATION_LIMITS.maxProvenance
          }
          onClick={() =>
            onChange([...provenance, { kind: "manual", note: "" }])
          }
        >
          <Plus size={13} />
          {t("Thêm căn cứ nhập tay")}
        </button>
      </div>
    </>
  );
}

export function DeclarationDraftEditor({
  state,
  shipment,
  issues,
  busy,
  drafts,
  onChange,
  onSaved,
  mutation,
  onManageGoods,
  focusFieldId,
  focusGoodsLineId,
}: Props) {
  const { t, locale, date } = useLocale();
  const [tab, setTab] = useState<EditorTab>(
    getDeclarationField(focusFieldId || "")?.tab || "general_1",
  );
  const [selectedId, setSelectedId] = useState(focusFieldId || "1.2");
  const [goodsId, setGoodsId] = useState(
    focusGoodsLineId || shipment.goods[0]?.id || "",
  );
  const [removal, setRemoval] = useState<DeclarationFieldEntry | null>(null);
  const [removalReason, setRemovalReason] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const selectedGoodsId = shipment.goods.some((line) => line.id === goodsId)
    ? goodsId
    : shipment.goods[0]?.id;
  const documents = state.documents.filter(
    (document) => document.caseId === shipment.id && document.active,
  );
  const entries = shipment.declarationDraft?.fields || [];
  const context = { caseId: shipment.id, documents, goods: shipment.goods, candidates: state.candidates };
  const coverage = getDeclarationCoverage(shipment.declarationDraft, context);
  const editable = shipment.status === "review";
  const available = DECLARATION_FIELDS.filter(
    (field) => field.scope !== "system" && field.tab === tab,
  );
  const filtered = available.filter((field) => {
    const lineId = field.scope === "item" ? selectedGoodsId : undefined;
    const key = declarationDraftKey(shipment.id, field.id, lineId);
    const entry = getDeclarationEntry(
      shipment.declarationDraft,
      field.id,
      lineId,
    );
    const matchesQuery =
      !query.trim() ||
      `${field.id} ${field.labelVi} ${field.labelEn} ${field.sectionVi} ${field.sectionEn}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase());
    return (
      matchesQuery &&
      (filter === "all" ||
        (filter === "pending" &&
          (!entry?.review || entry.stale || !!drafts[key])) ||
        (filter === "reviewed" &&
          !!entry?.review &&
          !entry.stale &&
          !drafts[key]) ||
        (filter === "issues" &&
          issues.some(
            (issue) =>
              issue.kind === "declaration" &&
              issue.field === field.id &&
              issue.id.includes(
                `:declaration:${declarationEntryKey(field.id, lineId)}:`,
              ),
          )))
    );
  });
  const selected =
    filtered.find((field) => field.id === selectedId) || filtered[0];
  const selectedLineId =
    selected?.scope === "item" ? selectedGoodsId : undefined;
  const key = selected
    ? declarationDraftKey(shipment.id, selected.id, selectedLineId)
    : "";
  const saved = selected
    ? getDeclarationEntry(
        shipment.declarationDraft,
        selected.id,
        selectedLineId,
      )
    : undefined;
  const draft = selected
    ? drafts[key] || fromEntry(selected, saved)
    : undefined;
  const dirty = !!drafts[key];
  const pendingCount = Object.keys(drafts).filter((key) => {
    try {
      return JSON.parse(key)[0] === shipment.id;
    } catch {
      return false;
    }
  }).length;
  const fieldIssues = issues.filter(
    (issue) =>
      issue.kind === "declaration" &&
      (!selected ||
        issue.id.includes(
          `:declaration:${declarationEntryKey(selected.id, selectedLineId)}:`,
        )),
  );
  const draftEntry: DeclarationFieldEntry | undefined =
    selected && draft
      ? {
          fieldId: selected.id,
          goodsLineId: selectedLineId,
          ...draft,
          review: null,
          stale: false,
          updatedBy: "",
          updatedAt: "",
          codeVerification: "unverified",
        }
      : undefined;
  const findings = draftEntry
    ? validateDeclarationEntry(draftEntry, context, shipment.declarationDraft)
    : [];
  const pendingEntries = Object.entries(drafts).filter(([key]) => {
    try {
      return JSON.parse(key)[0] === shipment.id;
    } catch {
      return false;
    }
  });
  const allDeclarationIssues = issues.filter(
    (issue) => issue.kind === "declaration",
  );
  const orphaned = entries.filter(
    (entry) =>
      entry.goodsLineId &&
      !shipment.goods.some((line) => line.id === entry.goodsLineId),
  );
  const groups = [...new Set(filtered.map((field) => field.section))];
  const update = (change: Partial<DeclarationUiDraft>) => {
    if (draft) {
      onChange(key, { ...draft, ...change });
      setError("");
    }
  };
  const save = async (review: boolean) => {
    if (!selected || !draft || busy) return;
    if (!draft.reason.trim()) {
      setError(t("Ghi lý do trước khi lưu hoặc xác nhận chỉ tiêu."));
      return;
    }
    if (review && findings.length) {
      setError(locale === "en" ? findings[0].messageEn : findings[0].messageVi);
      return;
    }
    const submitted = draft;
    const ok = await mutation(
      {
        type: "save_declaration_field",
        caseId: shipment.id,
        fieldId: selected.id,
        ...(selectedLineId ? { goodsLineId: selectedLineId } : {}),
        ...submitted,
        review,
      },
      t(
        review
          ? "Đã lưu và rà soát chỉ tiêu. Quy tắc hải quan vẫn chưa xác minh."
          : "Đã lưu bản nháp chỉ tiêu. Chưa đánh dấu đã rà soát.",
      ),
    );
    if (ok) {
      onSaved(key, submitted);
      setError("");
    }
  };
  const removeEntry = async () => {
    if (!removal || !removalReason.trim() || busy) return;
    if (
      await mutation(
        {
          type: "remove_declaration_field",
          caseId: shipment.id,
          fieldId: removal.fieldId,
          ...(removal.goodsLineId ? { goodsLineId: removal.goodsLineId } : {}),
          reason: removalReason,
        },
        t("Đã xóa bản nhập; lịch sử và căn cứ trước đó vẫn được giữ."),
      )
    ) {
      setRemoval(null);
      setRemovalReason("");
    }
  };
  const changeTab = (next: EditorTab) => {
    setTab(next);
    setQuery("");
    setFilter("all");
    setError("");
  };
  const scope = caseScopeMessage(shipment.caseType);
  if (scope) return (
    <section className="declaration-view">
      <div className="page-title"><div><h1>{t(scope.title)}</h1><p>{t(scope.description)}</p></div></div>
    </section>
  );
  return (
    <section className="declaration-view">
      <div className="page-title">
        <div>
          <span className="eyebrow">{t("BẢN KHAI ĐANG SOẠN")}</span>
          <h1>{t("Soạn thông tin khai báo")}</h1>
          <p>
            {t(
              "Điền theo nhóm thông tin, đối chiếu chứng từ và xác nhận từng quyết định.",
            )}
          </p>
        </div>
        <span className="badge amber">
          <ShieldCheck size={12} />
          {t("Chưa xác minh quy định / mã")}
        </span>
      </div>
      <div className="declaration-summary">
        <span>
          <strong>{coverage.reviewed}</strong> {t("mục đã rà soát nội bộ")}
        </span>
        <span>
          <strong>{allDeclarationIssues.length}</strong>{" "}
          {t("vấn đề của bản khai")}{" "}
          <button className="text-button" onClick={() => setFilter("issues")}>
            {t("Xem mục cần xử lý")}
          </button>
        </span>
        {pendingCount > 0 && (
          <span className="text-amber">
            <strong>{pendingCount}</strong> {t("mục chưa lưu")}
          </span>
        )}
      </div>
      {pendingEntries.length > 0 && (
        <details className="declaration-context">
          <summary>{t("Nội dung chưa lưu được giữ khi chuyển tab")}</summary>
          <ul className="declaration-pending-list">
            {pendingEntries.map(([draftKey, pending]) => {
              const [, fieldId, lineId] = JSON.parse(draftKey) as [
                string,
                string,
                string | null,
              ];
              const field = getDeclarationField(fieldId);
              return (
                <li key={draftKey}>
                  <span>
                    {fieldId} ·{" "}
                    {locale === "en" ? field?.labelEn : field?.labelVi}
                    {lineId &&
                      ` · ${shipment.goods.find((line) => line.id === lineId)?.description || t("Dòng hàng không còn tồn tại")}`}
                  </span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => onSaved(draftKey, pending)}
                  >
                    {t("Hủy thay đổi chưa lưu")}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {removal && (
        <div className="declaration-removal">
          <p>
            {t(
              "Xóa bản nhập đã lưu cho chỉ tiêu {p0}. Thao tác được ghi lịch sử và có thể làm mất hiệu lực các liên kết phụ thuộc.",
              { p0: removal.fieldId },
            )}
          </p>
          <label className="declaration-control">
            <span>{t("Lý do xóa bản nhập")}</span>
            <textarea
              rows={2}
              value={removalReason}
              disabled={busy}
              onChange={(event) => setRemovalReason(event.target.value)}
            />
          </label>
          <div>
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => setRemoval(null)}
            >
              {t("Hủy")}
            </button>
            <button
              className="button primary small"
              disabled={busy || !removalReason.trim()}
              onClick={() => void removeEntry()}
            >
              {t("Xóa bản nhập đã lưu")}
            </button>
          </div>
        </div>
      )}
      {orphaned.length > 0 && (
        <div className="declaration-orphan-note" role="alert">
          {t(
            "{p0} mục thuộc dòng hàng đã thay đổi hoặc bị xóa. Kiểm tra lại liên kết trước khi duyệt.",
            { p0: orphaned.length },
          )}
          <ul className="declaration-pending-list">
            {orphaned.map((entry) => (
              <li key={declarationEntryKey(entry.fieldId, entry.goodsLineId)}>
                <span>
                  {entry.fieldId} · {entry.goodsLineId}
                </span>
                <button
                  className="text-button"
                  disabled={
                    !editable ||
                    busy ||
                    !!drafts[
                      declarationDraftKey(
                        shipment.id,
                        entry.fieldId,
                        entry.goodsLineId,
                      )
                    ]
                  }
                  onClick={() => {
                    setRemoval(entry);
                    setRemovalReason("");
                  }}
                >
                  {t("Xóa bản nhập mồ côi")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="declaration-scope-bar">
        <div
          className="declaration-scope-tabs"
          role="tablist"
          aria-label={t("Nhóm thông tin tờ khai")}
        >
          {(Object.keys(TAB_LABELS) as EditorTab[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => changeTab(id)}
            >
              {id === "goods" ? <List size={15} /> : <FileText size={15} />}
              {t(TAB_LABELS[id])}
            </button>
          ))}
        </div>
        {tab === "goods" && (
          <label className="declaration-line-picker">
            <span>{t("Dòng hàng đang khai")}</span>
            <select
              value={selectedGoodsId || ""}
              disabled={!shipment.goods.length}
              onChange={(event) => setGoodsId(event.target.value)}
            >
              {!shipment.goods.length && (
                <option>{t("Chưa có dòng hàng")}</option>
              )}
              {shipment.goods.map((line, index) => (
                <option key={line.id} value={line.id}>
                  {index + 1} ·{" "}
                  {line.description || t("Dòng hàng chưa có mô tả")}
                </option>
              ))}
            </select>
            <button className="text-button" onClick={onManageGoods}>
              {t("Quản lý dòng hàng")}
            </button>
          </label>
        )}
      </div>
      {tab === "goods" && !shipment.goods.length ? (
        <div className="card declaration-empty">
          <List size={28} />
          <p>
            {t(
              "Tạo hoặc rà soát dòng hàng từ chứng từ trước. Các chỉ tiêu hàng hóa sẽ gắn với ID của từng dòng.",
            )}
          </p>
          <button className="button primary" onClick={onManageGoods}>
            {t("Mở bảng hàng hóa")}
          </button>
        </div>
      ) : (
        <div className="declaration-layout">
          <aside className="card declaration-navigator">
            <div className="declaration-search">
              <label className="search-field">
                <Search size={14} />
                <input
                  aria-label={t("Tìm thông tin khai báo")}
                  placeholder={t("Tìm tên thông tin…")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <select
                className="declaration-filter"
                aria-label={t("Lọc trạng thái nhập liệu")}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">{t("Tất cả thông tin")}</option>
                <option value="pending">{t("Cần hoàn thiện / rà soát")}</option>
                <option value="issues">{t("Có vấn đề đã phát hiện")}</option>
                <option value="reviewed">{t("Đã rà soát nội bộ")}</option>
              </select>
            </div>
            <div className="declaration-field-list">
              {groups.map((group) => {
                const fields = filtered.filter(
                  (field) => field.section === group,
                );
                return (
                  <div className="declaration-field-group" key={group}>
                    <h3>
                      {locale === "en"
                        ? fields[0].sectionEn
                        : fields[0].sectionVi}
                    </h3>
                    {fields.map((field) => {
                      const fieldKey = declarationDraftKey(
                        shipment.id,
                        field.id,
                        field.scope === "item" ? selectedGoodsId : undefined,
                      );
                      const entry = getDeclarationEntry(
                        shipment.declarationDraft,
                        field.id,
                        field.scope === "item" ? selectedGoodsId : undefined,
                      );
                      const reviewed =
                        entry?.review && !entry.stale && !drafts[fieldKey];
                      return (
                        <button
                          className={`declaration-field-option ${selected?.id === field.id ? "active" : ""}`}
                          key={field.id}
                          onClick={() => {
                            setSelectedId(field.id);
                            setError("");
                          }}
                          aria-pressed={selected?.id === field.id}
                        >
                          <code>{field.id}</code>
                          <span>
                            <strong>
                              {locale === "en" ? field.labelEn : field.labelVi}
                            </strong>
                            <small>
                              {t(entryStatus(entry, !!drafts[fieldKey]))}
                            </small>
                          </span>
                          {reviewed ? (
                            <Check size={13} className="text-green" />
                          ) : (
                            <ChevronRight size={13} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {!filtered.length && (
                <div className="declaration-empty">
                  {t("Không có thông tin phù hợp bộ lọc.")}
                </div>
              )}
            </div>
          </aside>
          <div className="card declaration-editor">
            {selected && draft ? (
              <>
                <div className="declaration-editor-heading">
                  <div>
                    <span className="eyebrow">
                      {locale === "en"
                        ? selected.sectionEn
                        : selected.sectionVi}{" "}
                      · {selected.id}
                    </span>
                    <h2>
                      {locale === "en" ? selected.labelEn : selected.labelVi}
                    </h2>
                    <p>
                      {locale === "en"
                        ? selected.structureEn
                        : selected.structureVi}
                    </p>
                  </div>
                  <span
                    className={`badge ${saved?.review && !saved.stale && !dirty ? "green" : "amber"}`}
                  >
                    {t(entryStatus(saved, dirty))}
                  </span>
                </div>
                {!editable && (
                  <div className="declaration-boundary">
                    <LockKeyhole size={16} />
                    <span>
                      {t(
                        "Phiên bản đã đóng băng. Mở lại hồ sơ để sửa thông tin khai báo.",
                      )}
                    </span>
                  </div>
                )}
                {saved?.stale && (
                  <div className="declaration-orphan-note" role="alert">
                    <AlertTriangle size={13} />{" "}
                    {translateSystemText(
                      saved.staleReason || t("Nguồn thay đổi · cần rà soát"),
                      locale,
                    )}
                  </div>
                )}
                {dirty && findings.length > 0 && (
                  <ul className="declaration-structural-list">
                    {findings.map((finding, index) => (
                      <li key={`${finding.code}:${finding.path}:${index}`}>
                        <AlertCircle size={13} />
                        <span>
                          {locale === "en"
                            ? finding.messageEn
                            : finding.messageVi}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {!dirty && fieldIssues.length > 0 && (
                  <ul className="declaration-structural-list">
                    {fieldIssues.map((issue) => {
                      const localized = translateIssue(issue, locale);
                      return (
                        <li key={issue.id}>
                          <AlertCircle size={13} />
                          <span>
                            <strong>{localized.title}</strong> ·{" "}
                            {localized.description}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!selected.editable ? (
                  <div className="declaration-boundary">
                    <LockKeyhole size={18} />
                    <span>
                      {locale === "en"
                        ? selected.blockedReasonEn
                        : selected.blockedReasonVi}
                    </span>
                  </div>
                ) : (
                  <>
                    <section className="declaration-section">
                      <h3>{t("Thông tin cần khai")}</h3>
                      <fieldset disabled={!editable || busy}>
                        <div className="declaration-applicability">
                          {(
                            [
                              "unresolved",
                              "applicable",
                              "not_applicable",
                            ] as const
                          ).map((applicability) => (
                            <label
                              key={applicability}
                              className={
                                draft.applicability === applicability
                                  ? "selected"
                                  : ""
                              }
                            >
                              <input
                                type="radio"
                                name={`applicability-${key}`}
                                checked={draft.applicability === applicability}
                                onChange={() => update({ applicability })}
                              />
                              {t(
                                applicability === "unresolved"
                                  ? "Chưa quyết định áp dụng"
                                  : applicability === "applicable"
                                    ? "Áp dụng"
                                    : "Không áp dụng",
                              )}
                            </label>
                          ))}
                        </div>
                        {draft.applicability !== "not_applicable" && (
                          <StructuredValueEditor
                            field={selected}
                            value={draft.value}
                            shipment={shipment}
                            goodsLineId={selectedLineId}
                            disabled={!editable || busy}
                            onChange={(value) => update({ value })}
                          />
                        )}
                        {draft.applicability === "not_applicable" && (
                          <p className="muted">
                            {t(
                              "Giá trị đã nhập được giữ trong bản nháp. Ghi căn cứ không áp dụng để người rà soát kiểm tra.",
                            )}
                          </p>
                        )}
                        <label className="declaration-control full declaration-applicability-basis">
                          <span>{t("Căn cứ áp dụng / không áp dụng")}</span>
                          <textarea
                            rows={3}
                            value={draft.basis}
                            onChange={(event) =>
                              update({ basis: event.target.value })
                            }
                            placeholder={t(
                              "Nêu tình huống của hồ sơ và căn cứ lựa chọn.",
                            )}
                          />
                        </label>
                        <details className="declaration-context">
                          <summary>{t("Căn cứ áp dụng và điều kiện")}</summary>
                          {(() => {
                            const reference = VNACCS_FIELDS.find(
                              (field) => field.id === selected.id,
                            );
                            return (
                              reference && (
                                <p>
                                  {locale === "en"
                                    ? reference.requirement.summaryEn
                                    : reference.requirement.summaryVi}
                                </p>
                              )
                            );
                          })()}
                        </details>
                      </fieldset>
                    </section>
                    <section className="declaration-section">
                      <h3>{t("Chứng từ và căn cứ")}</h3>
                      <p>
                        {t(
                          "Gắn đoạn trích đúng phiên bản, hoặc ghi căn cứ nhập tay. Dữ liệu nguồn không tự trở thành quyết định được duyệt.",
                        )}
                      </p>
                      <EvidenceEditor
                        provenance={draft.provenance}
                        documents={documents}
                        candidates={state.candidates}
                        caseId={shipment.id}
                        disabled={!editable || busy}
                        onChange={(provenance) => update({ provenance })}
                      />
                    </section>
                    <section className="declaration-section">
                      <label className="declaration-control full">
                        <span>{t("Lý do lưu / xác nhận")}</span>
                        <textarea
                          rows={2}
                          disabled={!editable || busy}
                          value={draft.reason}
                          onChange={(event) =>
                            update({ reason: event.target.value })
                          }
                          placeholder={t(
                            "Giải thích thay đổi hoặc căn cứ đã đối chiếu.",
                          )}
                        />
                      </label>
                    </section>
                    {error && (
                      <div className="inline-form-error" role="alert">
                        <AlertCircle size={14} />
                        {translateSystemText(error, locale)}
                      </div>
                    )}
                    <div className="declaration-save-bar">
                      <span>
                        {t(
                          "Lưu bản nháp chưa xác nhận nội dung. Rà soát nội bộ không xác minh pháp luật.",
                        )}
                      </span>
                      <div>
                        <button
                          className="button secondary"
                          disabled={!editable || busy || !draft.reason.trim()}
                          onClick={() => void save(false)}
                        >
                          {busy ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Save size={14} />
                          )}
                          {t("Lưu bản nháp")}
                        </button>
                        <button
                          className="button primary"
                          disabled={
                            !editable ||
                            busy ||
                            !draft.reason.trim() ||
                            findings.length > 0
                          }
                          onClick={() => void save(true)}
                        >
                          <CheckCheck size={15} />
                          {t("Lưu & rà soát nội bộ")}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                <details className="declaration-context">
                  <summary>
                    {t("Chi tiết kiểm tra, lịch sử và nguồn quy định")}
                  </summary>
                  <div className="declaration-dimensions">
                    <div className="declaration-dimension">
                      <span>{t("Rà soát nội bộ")}</span>
                      <strong>{t(entryStatus(saved, dirty))}</strong>
                    </div>
                    <div className="declaration-dimension">
                      <span>{t("Tính áp dụng")}</span>
                      <strong>
                        {t(
                          draft.applicability === "applicable"
                            ? "Áp dụng"
                            : draft.applicability === "not_applicable"
                              ? "Không áp dụng"
                              : "Chưa quyết định",
                        )}
                      </strong>
                    </div>
                    <div className="declaration-dimension">
                      <span>{t("Cấu trúc dữ liệu")}</span>
                      <strong>
                        {t(
                          dirty
                            ? "Chờ kiểm tra khi lưu"
                            : saved &&
                                !validateDeclarationEntry(
                                  saved,
                                  context,
                                  shipment.declarationDraft,
                                ).length
                              ? "Đã qua kiểm tra cấu trúc"
                              : "Chưa xác nhận đầy đủ",
                        )}
                      </strong>
                    </div>
                    <div className="declaration-dimension">
                      <span>{t("Danh mục mã")}</span>
                      <strong className="text-amber">
                        {t("Chưa xác minh")}
                      </strong>
                    </div>
                    <div className="declaration-dimension">
                      <span>{t("Pháp luật hiện hành")}</span>
                      <strong className="text-amber">
                        {t("Chưa xác minh")}
                      </strong>
                    </div>
                    <div className="declaration-dimension">
                      <span>{t("Ánh xạ ECUS")}</span>
                      <strong className="text-amber">
                        {t("Chưa xác minh")}
                      </strong>
                    </div>
                  </div>
                  {saved?.review && (
                    <div className="declaration-review-record">
                      <strong>{saved.review.actorName}</strong> ·{" "}
                      {date(saved.review.at)}
                      <blockquote>{saved.review.reason}</blockquote>
                    </div>
                  )}
                  {selected.blockedComponents.map((component, index) => (
                    <p className="declaration-code-note" key={index}>
                      <AlertTriangle size={13} />
                      {component.sourceCell}:{" "}
                      {locale === "en"
                        ? component.reasonEn
                        : component.reasonVi}
                    </p>
                  ))}
                  {selected.sourceRefs.map((reference, index) => {
                    const source = VNACCS_SOURCES.find(
                      (source) => source.id === reference.sourceId,
                    );
                    return (
                      <p key={index}>
                        {source ? (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title}
                            <ArrowUpRight size={12} />
                          </a>
                        ) : (
                          reference.sourceId
                        )}{" "}
                        · {reference.pages.join(", ")} ·{" "}
                        {reference.effectiveFrom}
                      </p>
                    );
                  })}
                  <p>
                    {t(
                      "Bố cục tham khảo ECUS5-VNACCS 2018; đây không phải đặc tả nhập ECUS đã xác minh.",
                    )}
                  </p>
                  <p>
                    {t(
                      "Không ký số, không truyền IDA/IDC. Ánh xạ và quy tắc hiện hành vẫn cần xác minh độc lập.",
                    )}
                  </p>
                  {saved && selected.editable && (
                    <button
                      className="text-button declaration-remove-button"
                      disabled={!editable || busy || dirty}
                      onClick={() => {
                        setRemoval(saved);
                        setRemovalReason("");
                      }}
                    >
                      {t("Xóa bản nhập đã lưu")}
                    </button>
                  )}
                </details>
              </>
            ) : (
              <div className="declaration-empty">
                {t("Chọn một thông tin ở danh sách bên trái.")}
              </div>
            )}
          </div>
        </div>
      )}
      <details className="declaration-context declaration-customs-fields">
        <summary>
          <LockKeyhole size={13} />{" "}
          {t("Thông tin thuộc cơ quan / hệ thống hải quan")}
        </summary>
        <p>
          {t(
            "Các mục sau chỉ để nhận biết. AICD không nhập, sinh hoặc giả lập giá trị chính thức.",
          )}
        </p>
        {DECLARATION_FIELDS.filter((field) => field.scope === "system").map(
          (field) => (
            <p key={field.id}>
              <code>{field.id}</code> ·{" "}
              {locale === "en" ? field.labelEn : field.labelVi}{" "}
              <span className="badge">{t("Chỉ đọc")}</span>
            </p>
          ),
        )}
      </details>
    </section>
  );
}
