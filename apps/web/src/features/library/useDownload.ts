import { useMutation } from "@tanstack/react-query";
import { API_BASE } from "../../api/client";
import { useSession } from "../../state/session";

export type DownloadResult =
  | { kind: "verified"; sha256: string }
  | { kind: "integrity-failed"; message: string };

// A 422 means the stored bytes no longer match the recorded hash. We surface it as a
// result, not a thrown error, because it is an expected outcome the UI must explain.
export function useDownload(id: string, name: string) {
  return useMutation<DownloadResult, Error>({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/v1/files/${id}/content`, {
        headers: { Authorization: `Bearer ${useSession.getState().token}` },
      });
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        return { kind: "integrity-failed", message: body?.message ?? "Stored bytes do not match the recorded SHA-256." };
      }
      if (!res.ok) throw new Error(`Download failed (${res.status}). The file is still stored.`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      return { kind: "verified", sha256: res.headers.get("X-Content-SHA256") ?? "" };
    },
  });
}
