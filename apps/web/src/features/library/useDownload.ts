import { useMutation } from "@tanstack/react-query";
import { API_BASE, api, authHeaders } from "../../api/client";

export type DownloadResult =
  | { kind: "verified"; sha256: string }
  | { kind: "started"; sha256: string }
  | { kind: "integrity-failed"; message: string };

function saveAs(href: string, name: string) {
  const a = Object.assign(document.createElement("a"), { href, download: name });
  a.click();
}

// Small files: fetch with the bearer header so a 422 can be shown as an explicit
// integrity failure. The whole file is buffered, which is why large files do not use it.
async function downloadBuffered(id: string, name: string): Promise<DownloadResult> {
  const res = await fetch(`${API_BASE}/api/v1/files/${id}/content`, { headers: authHeaders() });
  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { kind: "integrity-failed", message: body?.message ?? "Stored bytes do not match the recorded SHA-256." };
  }
  if (!res.ok) throw new Error(`Download failed (${res.status}). The file is still stored.`);
  const url = URL.createObjectURL(await res.blob());
  saveAs(url, name);
  URL.revokeObjectURL(url);
  return { kind: "verified", sha256: res.headers.get("X-Content-SHA256") ?? "" };
}

// Large files: a 60 s link lets the browser stream straight to disk with flat memory.
// The browser owns the transfer from here, so an integrity failure mid-stream shows as a
// failed download; the expected hash is returned so the user can check the saved file.
async function downloadStreamed(id: string, name: string): Promise<DownloadResult> {
  const { data } = await api.POST("/api/v1/files/{id}/download-link", { params: { path: { id } } });
  if (!data) throw new Error("Could not prepare the download link. The file is still stored; try again.");
  saveAs(`${API_BASE}${data.url}`, name);
  return { kind: "started", sha256: data.sha256 };
}

export function useDownload(id: string, name: string, streamed: boolean) {
  return useMutation<DownloadResult, Error>({
    mutationFn: () => (streamed ? downloadStreamed(id, name) : downloadBuffered(id, name)),
  });
}
