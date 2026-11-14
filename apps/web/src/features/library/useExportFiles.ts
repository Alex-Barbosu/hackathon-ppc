import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { FileMeta } from "../../lib/domain";
import { downloadCsv, stamp, toCsv, type Column } from "../../lib/csv";
import { searchQuery, useFilters } from "./useFileSearch";

// Enough for every demo; past this a spreadsheet is the wrong tool and the cap is said out loud.
const MAX_ROWS = 2000;
const COLUMNS: Column<FileMeta>[] = [
  { header: "Name", value: (f) => f.originalName ?? f.id },
  { header: "Category", value: (f) => f.category },
  { header: "Region", value: (f) => f.region },
  { header: "County", value: (f) => f.county },
  { header: "Storage", value: (f) => f.storage },
  { header: "Size (bytes)", value: (f) => f.sizeBytes },
  { header: "Stored at", value: (f) => f.storedAt },
  { header: "Encrypted", value: (f) => f.encrypted },
  { header: "Status", value: (f) => f.status },
  { header: "SHA-256", value: (f) => f.sha256 },
  { header: "Station", value: (f) => f.recording?.station },
  { header: "Fault time", value: (f) => f.recording?.faultTime },
  { header: "File ID", value: (f) => f.id },
];

// Exports every page of the current search, not only the 20 rows on screen.
export function useExportFiles() {
  const filters = useFilters((s) => s.filters);
  return useMutation({
    mutationFn: async () => {
      const rows: FileMeta[] = [];
      let total = 0;
      for (let page = 0; rows.length < MAX_ROWS; page++) {
        const { data } = await api.GET("/api/v1/files", { params: { query: searchQuery(filters, page, 100) } });
        if (!data) throw new Error("The export could not reach the API. Nothing was downloaded.");
        rows.push(...data.items);
        total = data.total;
        if (data.items.length === 0 || rows.length >= data.total) break;
      }
      downloadCsv(`filegrid-files-${stamp()}.csv`, toCsv(rows.slice(0, MAX_ROWS), COLUMNS));
      return { count: Math.min(rows.length, MAX_ROWS), total };
    },
  });
}
