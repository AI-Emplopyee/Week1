"use client";
import { fetchWithSession } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import type { Action, WorkspaceResponse } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
export type ApiResponse = WorkspaceResponse & {
  error?: string;
  notice?: string;
};
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Không thể hoàn thành thao tác. Vui lòng thử lại.";

/** Serializes edits against the latest installed revision. A conflict never replaces input drafts. */
export function useWorkspaceSession() {
  const { t } = useLocale();
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const stateRef = useRef<WorkspaceResponse | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [conflict, setConflict] = useState<WorkspaceResponse | null>(null);
  const conflictRef = useRef(false);
  const requestQueue = useRef<Promise<unknown>>(Promise.resolve());
  const install = useCallback((response: WorkspaceResponse) => {
    stateRef.current = response;
    setData(response);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchWithSession("/api/workspace");
      const body = (await response.json()) as ApiResponse;
      if (!response.ok)
        throw new Error(body.error || t("Không thể tải không gian làm việc."));
      install(body);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [install, t]);
  useEffect(() => {
    const controller = new AbortController();
    fetchWithSession("/api/workspace", { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as ApiResponse;
        if (!response.ok)
          throw new Error(body.error || "Không thể tải không gian làm việc.");
        install(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [install]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const mutation = useCallback(
    (action: Action, success?: string): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        if (conflictRef.current) {
          setError(
            t(
              "Nạp bản mới trước khi lưu tiếp. Nội dung bạn nhập vẫn được giữ lại.",
            ),
          );
          return false;
        }
        setBusy(true);
        setError("");
        try {
          const response = await fetchWithSession("/api/workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              revision: stateRef.current?.state.revision,
              action,
            }),
          });
          const body = (await response.json()) as ApiResponse;
          if (response.status === 409) {
            setConflict(body);
            conflictRef.current = true;
            throw new Error(
              t(
                "Một thành viên khác đã cập nhật hồ sơ. Bản nhập của bạn được giữ lại.",
              ),
            );
          }
          if (!response.ok)
            throw new Error(body.error || t("Thao tác chưa được lưu."));
          install(body);
          if (success) setToast(success);
          return true;
        } catch (e) {
          setError(errorMessage(e));
          return false;
        } finally {
          setBusy(false);
        }
      };
      const result = requestQueue.current.then(run, run);
      requestQueue.current = result;
      return result;
    },
    [install, t],
  );

  const refreshConflict = async () => {
    try {
      const response = await fetchWithSession("/api/workspace");
      const body = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(body.error);
      install(body);
      setConflict(null);
      conflictRef.current = false;
      setError("");
      setToast(
        t(
          "Đã nạp bản mới. Các ô bạn đang chỉnh sửa được giữ nguyên để đối chiếu.",
        ),
      );
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  return {
    data,
    stateRef,
    error,
    setError,
    toast,
    setToast,
    busy,
    setBusy,
    loading,
    conflict,
    setConflict,
    conflictRef,
    install,
    load,
    mutation,
    refreshConflict,
  };
}
