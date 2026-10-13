"use client";
import { useLocale } from "@/lib/i18n";
import { fieldLabel } from "@/lib/i18n-core";
import type {
  Action,
  GoodsLine,
  ShipmentCase,
  WorkspaceState,
} from "@/lib/types";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  FileText,
  Plus,
  Save,
  X,
} from "lucide-react";
import { Empty } from "./shared";
type Props = {
  state: WorkspaceState;
  shipment: ShipmentCase;
  draft: GoodsLine[] | null;
  busy: boolean;
  reviewReason: string;
  onChange: (lines: GoodsLine[] | null) => void;
  onSaved: (lines: GoodsLine[]) => void;
  onError: (message: string) => void;
  onEvidence: (documentId: string, page: number) => void;
  mutation: (action: Action, success?: string) => Promise<boolean>;
};
export function SourceGoods({
  state,
  shipment: current,
  draft: goodsDraft,
  busy,
  reviewReason,
  onChange: setGoodsDraft,
  onSaved,
  onError,
  onEvidence,
  mutation,
}: Props) {
  const { t, locale } = useLocale();
  const editable = current.status === "review";
  return (
    <div className="goods-editor">
      <div className="goods-warning">
        <AlertTriangle size={15} />
        {t(
          "HS, xuất xứ và thuế suất được nhập tay, chưa xác minh. Không tính thuế hoặc xác nhận ưu đãi.",
        )}
      </div>
      <div className="table-scroll">
        <table className="goods-table">
          <thead>
            <tr>
              <th>#</th>
              {[
                t("Mô tả hàng hóa"),
                t("Số lượng"),
                t("ĐVT"),
                t("Đơn giá"),
                t("Thành tiền"),
                t("Mã HS*"),
                t("Xuất xứ*"),
                t("Thuế NK*"),
                "VAT*",
              ].map((s) => (
                <th key={s}>{s}</th>
              ))}
              <th>{t("Rà soát")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(goodsDraft || current.goods).map((line, index) => (
              <tr key={line.id} id={`goods-row-${line.id}`}>
                <td>
                  {index + 1}
                  {line.reviewed && <Check size={12} className="text-green" />}
                </td>
                {(
                  [
                    "description",
                    "quantity",
                    "unit",
                    "unitPrice",
                    "amount",
                    "hsCode",
                    "origin",
                    "dutyRate",
                    "vatRate",
                  ] as const
                ).map((key) => (
                  <td key={key}>
                    <input
                      aria-label={t("{p0} hàng {p1}", {
                        p0: fieldLabel(key, locale),
                        p1: index + 1,
                      })}
                      disabled={!editable}
                      value={line[key]}
                      placeholder={
                        key === "hsCode" ||
                        key === "origin" ||
                        key === "dutyRate" ||
                        key === "vatRate"
                          ? t("Chưa xác minh")
                          : "—"
                      }
                      onChange={(e) =>
                        setGoodsDraft(
                          (goodsDraft || current.goods).map((g, i) =>
                            i === index
                              ? {
                                  ...g,
                                  [key]: e.target.value,
                                  manual: true,
                                  reviewed: false,
                                }
                              : g,
                          ),
                        )
                      }
                    />
                  </td>
                ))}
                <td>
                  <button
                    className="button secondary small"
                    disabled={busy || !editable || !!goodsDraft || line.reviewed}
                    onClick={async () => {
                      if (!reviewReason.trim()) {
                        onError(t("Nhập lý do rà soát trước khi xác nhận hàng hóa."));
                        return;
                      }
                      await mutation(
                        {
                          type: "review_goods",
                          caseId: current.id,
                          goods: current.goods,
                          reviewedLineIds: [line.id],
                          reason: reviewReason,
                        },
                        t("Đã xác nhận dòng {p0}.", { p0: index + 1 }),
                      );
                    }}
                  >
                    <Check size={14} />
                    {line.reviewed
                      ? t("Đã xác nhận")
                      : t("Xác nhận dòng {p0}", { p0: index + 1 })}
                  </button>
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={t("Bỏ dòng {p0}", { p0: index + 1 })}
                    disabled={!editable}
                    onClick={() =>
                      setGoodsDraft(
                        (goodsDraft || current.goods).filter(
                          (_, i) => i !== index,
                        ),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!current.goods.length && !goodsDraft?.length && (
        <Empty icon={FileText} title={t("Chưa có dòng hàng")}>
          <p>{t("Nhập dòng hàng từ chứng từ và ghi rõ lý do rà soát.")}</p>
        </Empty>
      )}
      <div className="goods-actions">
        <button
          className="button secondary small"
          disabled={!editable}
          onClick={() =>
            setGoodsDraft([
              ...(goodsDraft || current.goods),
              {
                id: crypto.randomUUID(),
                description: "",
                quantity: "",
                unit: "",
                unitPrice: "",
                amount: "",
                hsCode: "",
                origin: "",
                dutyRate: "",
                vatRate: "",
                reviewed: false,
                manual: true,
              },
            ])
          }
        >
          <Plus size={14} />
          {t("Thêm dòng hàng")}
        </button>
        <button
          className="button primary small"
          disabled={busy || !editable || !goodsDraft?.length}
          onClick={async () => {
            if (!reviewReason.trim()) {
              onError(t("Nhập lý do rà soát trước khi lưu hàng hóa."));
              return;
            }
            const submittedGoods = goodsDraft || current.goods;
            if (
              await mutation(
                {
                  type: "review_goods",
                  caseId: current.id,
                  goods: submittedGoods,
                  reviewedLineIds: [],
                  reason: reviewReason,
                },
                t("Đã lưu thay đổi hàng hóa; chưa xác nhận thêm dòng nào."),
              )
            )
              onSaved(submittedGoods);
          }}
        >
          <Save size={14} />
          {t("Lưu thay đổi hàng hóa")}
        </button>
      </div>
      {goodsDraft && <p>{t("Lưu thay đổi trước khi xác nhận từng dòng.")}</p>}
      <h3 className="section-subtitle">{t("Nguồn của từng dòng")}</h3>
      {current.goods.map((g, i) => (
        <div className="goods-source" key={g.id}>
          <strong>
            {t("Dòng ")}
            {i + 1} · {g.description}
          </strong>
          <p>{g.originalText || t("Người rà soát nhập tay")}</p>
          {g.sourceDocumentId && (
            <button
              className="evidence-link"
              onClick={() => {
                onEvidence(g.sourceDocumentId || "", g.sourcePage || 1);
              }}
            >
              {state.documents.find((d) => d.id === g.sourceDocumentId)?.name} ·{" "}
              {t("trang")} {g.sourcePage || 1}
              <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
