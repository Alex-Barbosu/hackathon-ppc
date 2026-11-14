import assert from "node:assert/strict";
import { test } from "node:test";
import { cell, toCsv } from "./csv.ts";

test("quotes commas, quotes and newlines", () => {
  assert.equal(cell('a,"b"'), '"a,""b"""');
  assert.equal(cell("two\nlines"), '"two\nlines"');
  assert.equal(cell(null), "");
  assert.equal(cell(42), "42");
});

test("neutralises spreadsheet formulas in text", () => {
  assert.equal(cell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(cell("-5"), "'-5");
  assert.equal(cell(-5), "-5");
});

test("builds a header and CRLF rows", () => {
  const csv = toCsv([{ n: "Timiș", c: 3 }], [{ header: "County", value: (r) => r.n }, { header: "Outages", value: (r) => r.c }]);
  assert.equal(csv, "County,Outages\r\nTimiș,3\r\n");
});
