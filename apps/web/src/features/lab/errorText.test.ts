import assert from "node:assert/strict";
import { test } from "node:test";
import type { LabCell } from "../../lib/domain.ts";
import { errorText, rejectedByDesign } from "./errorText.ts";

const MB = 1024 * 1024;
const failed: Pick<LabCell, "category" | "storage" | "write" | "errors" | "errorSamples"> = {
  category: "video", storage: "db", errors: 2, errorSamples: ["upload:TOO_LARGE"],
};

test("TOO_LARGE names the cell's own size and the S3 + tus way out", () => {
  assert.equal(
    errorText("upload:TOO_LARGE", { sizeBytes: 100 * MB }),
    "Rejected: 100 MB is over this storage's upload limit. Large files need a streaming, resumable path (S3 + tus).",
  );
});

test("integrity and availability codes read as plain sentences", () => {
  assert.equal(errorText("download:INTEGRITY_FAILED", { sizeBytes: 1 }), "Downloaded bytes did not match the stored SHA-256.");
  assert.equal(errorText("upload:STORAGE_UNAVAILABLE", { sizeBytes: 1 }), "Storage was unavailable during the run.");
});

test("an unknown code falls back to the code itself", () => {
  assert.equal(errorText("upload:HTTP_502", { sizeBytes: 1 }), "upload:HTTP_502");
  assert.equal(errorText("something:ODD", { sizeBytes: 1 }), "something:ODD");
});

test("video on db or ftp refused for size is rejected by design", () => {
  assert.equal(rejectedByDesign(failed), true);
  assert.equal(rejectedByDesign({ ...failed, storage: "ftp" }), true);
});

test("other failures keep the error look", () => {
  assert.equal(rejectedByDesign({ ...failed, errorSamples: ["upload:STORAGE_UNAVAILABLE"] }), false);
  assert.equal(rejectedByDesign({ ...failed, errorSamples: ["upload:TOO_LARGE", "upload:NETWORK"] }), false);
  assert.equal(rejectedByDesign({ ...failed, storage: "s3" }), false);
  assert.equal(rejectedByDesign({ ...failed, category: "outage" }), false);
});
