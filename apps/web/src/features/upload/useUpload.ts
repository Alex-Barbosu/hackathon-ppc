import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Category, FileReceipt, Region } from "../../lib/domain";

interface UploadInput {
  file: File;
  category: Category;
  region: Region;
}

export class UploadError extends Error {}

// Raw server text ("IOException caught while copying") means nothing to a dispatcher.
// Say what happened, what is safe, and what to do next.
function explain(status: number): string {
  if (status === 503) return "A storage is unavailable right now, so the file was not stored. It is still on your device; try again in a minute.";
  if (status === 413) return "This file is larger than the limit for its category. Nothing was stored.";
  if (status === 401 || status === 403) return "Your role is not allowed to upload this category. Nothing was stored.";
  return "The upload was not accepted. Nothing was stored.";
}

// Multipart path for outage and document files (≤ 10 MB).
export function useUpload() {
  return useMutation<FileReceipt, UploadError, UploadInput>({
    mutationFn: async ({ file, category, region }) => {
      const { data, response } = await api.POST("/api/v1/files", {
        // The generated type models the binary part as string; the serializer sends the real File.
        body: { category, region, file: file as unknown as string },
        bodySerializer: () => {
          const form = new FormData();
          form.set("category", category);
          form.set("region", region);
          form.set("file", file);
          return form;
        },
      });
      if (!data) throw new UploadError(explain(response.status));
      return data;
    },
  });
}
