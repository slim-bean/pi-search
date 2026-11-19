import assert from "node:assert/strict";
import { test } from "node:test";
import { enumValue } from "../src/enum";
import { loadTools } from "./tool-harness";

test("enum narrowing accepts only exact values without coercion", () => {
  const values = ["day", "week", "month", "year"] as const;
  for (const value of values) assert.equal(enumValue(value, values, "recency"), value);
  for (const value of [undefined, null, {}, ["day"], 1, "DAY", "never"])
    assert.throws(() => enumValue(value, values, "recency"), /Invalid recency/);
});

test("registered search/fetch tools reject invalid enums before credentials or network", async () => {
  const tools = await loadTools();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected network access"); };
  try {
    for (const recency of ["never", {}, ["day"]]) {
      // No context: a provider/credential lookup would fail with a different error.
      await assert.rejects(tools.get("web_search")!.execute("test", { query: "fixture", recency }), /Invalid recency/);
    }
    for (const format of ["pdf", {}, ["markdown"]]) {
      await assert.rejects(tools.get("web_fetch")!.execute("test", { url: "https://fixture.example/", format }), /Invalid format/);
    }
  } finally {
    globalThis.fetch = oldFetch;
  }
});
