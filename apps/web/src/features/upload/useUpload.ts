import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Category, FileReceipt, Region } from "../../lib/domain";

interface UploadInput {
  file: File;
  category: Category;
  region: Region;
}

export class UploadError extends Error {}

// Multipart path for outage and document files (≤ 10 MB).
export function useUpload() {
  return useMutation<FileReceipt, UploadError, UploadInput>({
    mutationFn: async ({ file, category, region }) => {
      const { data, error } = await api.POST("/api/v1/files", {
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
      if (!data) throw new UploadError(error?.message ?? "The upload was not accepted. Nothing was stored.");
      return data;
    },
  });
}
