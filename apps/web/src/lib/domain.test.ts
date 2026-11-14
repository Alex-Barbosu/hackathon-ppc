import assert from "node:assert/strict";
import { test } from "node:test";
import { COUNTIES, countiesIn } from "./domain.ts";

test("every county belongs to one region, and the regions split the eleven between them", () => {
  assert.deepEqual(countiesIn("banat"), ["Timiș", "Arad", "Hunedoara", "Caraș-Severin"]);
  assert.equal(countiesIn("muntenia").length + countiesIn("banat").length + countiesIn("dobrogea").length, COUNTIES.length);
  assert.equal(COUNTIES.length, 11);
});
