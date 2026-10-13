export type IntakeProgress = { page: number; total: number; stage: 'reading'; progress: number };
export type IntakeOptions = { onProgress?: (progress: IntakeProgress) => void; signal?: AbortSignal };

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Đã hủy tiếp nhận.', 'AbortError');
}

/** Keep pending image decoding and file preparation bounded. */
export async function withIntakeTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
