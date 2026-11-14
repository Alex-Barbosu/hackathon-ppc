import assert from "node:assert/strict";
import { test } from "node:test";
import { aiConfigFromEnv, BudgetExceeded, budgeted, CallBudget } from "./llm.js";
import { fakeLlm, textMessage } from "./testkit.js";

test("the budget allows N calls per rolling hour, then recovers", () => {
  let t = 0;
  const b = new CallBudget(2, () => t);
  assert.deepEqual([b.take(), b.take(), b.take()], [true, true, false]);
  t = 3_600_001;
  assert.equal(b.take(), true);
});

test("a budgeted client throws BudgetExceeded and never reaches the model", async () => {
  const inner = fakeLlm([textMessage("a"), textMessage("b")]);
  const llm = budgeted(inner, new CallBudget(1));
  await llm.create({ model: "m", max_tokens: 1, messages: [] });
  await assert.rejects(() => llm.create({ model: "m", max_tokens: 1, messages: [] }), BudgetExceeded);
  assert.equal(inner.requests.length, 1);
});

test("no API key means no client; models default to Haiku and come from the environment", () => {
  const off = aiConfigFromEnv({});
  assert.equal(off.llm, null);
  assert.equal(off.narratorModel, "claude-haiku-5-5");
  assert.equal(off.analystModel, "claude-haiku-5-5");
  const on = aiConfigFromEnv({ ANTHROPIC_API_KEY: "sk-ant-test", ANALYST_MODEL: "claude-sonnet-5-5", NARRATOR_MODEL: " " });
  assert.notEqual(on.llm, null);
  assert.equal(on.analystModel, "claude-sonnet-5-5");
  assert.equal(on.narratorModel, "claude-haiku-5-5");
});
