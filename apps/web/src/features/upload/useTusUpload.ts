import { useCallback, useEffect, useRef, useState } from "react";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { API_BASE, api } from "../../api/client";
import { useSession } from "../../state/session";
import type { FileReceipt, Region } from "../../lib/domain";

export type TusPhase = "idle" | "uploading" | "paused" | "waiting" | "done" | "failed";

export interface TusState {
  phase: TusPhase;
  percent: number;
  uploaded: number;
  total: number;
  resumedAfterDisconnect: boolean;
  receipt: FileReceipt | null;
  message: string | null;
}

const INITIAL: TusState = {
  phase: "idle", percent: 0, uploaded: 0, total: 0, resumedAfterDisconnect: false, receipt: null, message: null,
};

// Wraps Uppy so components only see plain state. Uppy's tus plugin retries on its own
// (HEAD to find the offset, then PATCH), which is what makes the upload resume without a click.
export function useTusUpload(region: Region) {
  const [state, setState] = useState<TusState>(INITIAL);
  const uppyRef = useRef<Uppy | null>(null);
  const fileIdHeader = useRef<string | null>(null);
  const disconnected = useRef(false);
  const patch = useCallback((next: Partial<TusState>) => setState((s) => ({ ...s, ...next })), []);

  useEffect(() => {
    const uppy = new Uppy({ autoProceed: false });
    uppy.use(Tus, {
      endpoint: `${API_BASE}/api/v1/files/tus`,
      chunkSize: 16 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      removeFingerprintOnSuccess: true,
      // tus-js-client retries internally and Uppy does not emit upload-retry for that, so this
      // hook is the only reliable signal that the link dropped. Network errors and 5xx are retried.
      onShouldRetry: (err) => {
        const status = err.originalResponse?.getStatus();
        const retry = status === undefined || status >= 500 || status === 409 || status === 423;
        if (retry) {
          disconnected.current = true;
          patch({ phase: "waiting", message: "Connection lost. Retrying from the last confirmed byte." });
        }
        return retry;
      },
      onBeforeRequest: (req) => req.setHeader("Authorization", `Bearer ${useSession.getState().token}`),
      onAfterResponse: (_req, res) => {
        const id = res.getHeader("X-FileGrid-File-Id");
        if (id) fileIdHeader.current = id;
      },
    });
    uppy.on("upload-progress", (_f, p) => {
      const total = p.bytesTotal ?? 0;
      const resumed = disconnected.current;
      disconnected.current = false;
      patch({
        phase: "uploading", uploaded: p.bytesUploaded, total,
        percent: total ? Math.round((p.bytesUploaded / total) * 100) : 0,
        ...(resumed ? { resumedAfterDisconnect: true, message: null } : {}),
      });
    });
    uppy.on("upload-error", (_f, err) => patch({ phase: "failed", message: err.message }));
    uppy.on("upload-success", async () => {
      const id = fileIdHeader.current;
      if (!id) return patch({ phase: "done", percent: 100, message: "Stored. Open the Library to see the receipt." });
      const { data } = await api.GET("/api/v1/files/{id}", { params: { path: { id } } });
      patch({ phase: "done", percent: 100, receipt: data ?? null });
    });
    uppyRef.current = uppy;
    return () => uppy.destroy();
  }, [patch]);

  const start = useCallback((file: File) => {
    const uppy = uppyRef.current;
    if (!uppy) return;
    uppy.cancelAll();
    fileIdHeader.current = null;
    setState({ ...INITIAL, total: file.size, phase: "uploading" });
    uppy.addFile({ name: file.name, type: file.type, data: file, meta: { category: "video", filename: file.name, region } });
    void uppy.upload();
  }, [region]);

  const toggle = useCallback(() => {
    const uppy = uppyRef.current;
    const id = uppy?.getFiles()[0]?.id;
    if (!uppy || !id) return;
    if (uppy.getFile(id)?.error) {
      void uppy.retryUpload(id);
      return patch({ phase: "uploading", message: null });
    }
    const paused = uppy.pauseResume(id);
    patch({ phase: paused ? "paused" : "uploading" });
  }, [patch]);

  const reset = useCallback(() => { uppyRef.current?.cancelAll(); setState(INITIAL); }, []);

  return { state, start, toggle, reset };
}
