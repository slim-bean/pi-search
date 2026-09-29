import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchReadable, extractFromHtml } from "../src/fetch/fetch";

const html = '<html><head><title>Fixture</title></head><body><article><h1>Fixture</h1><p>Current rendered content.</p><a href="/next">Next</a><pre>example code</pre></article></body></html>';

test("browser-only uses only the gateway, regardless of proxy selection, and never probes llms.txt", async () => {
  const original = globalThis.fetch;
  const env = { ...process.env };
  const calls: string[] = [];
  try {
    process.env.PI_SEARCH_FETCH_MODE = "browser-only";
    delete process.env.PI_SEARCH_BROWSER_TOKEN_FILE;
    process.env.PI_SEARCH_FETCH_PROXY = "jina";
    process.env.PI_SEARCH_BROWSER_URL = "http://127.0.0.1:19377";
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      assert.equal(init?.method, "POST");
      assert.equal(JSON.parse(init?.body as string).url, "https://private.example/account");
      return Response.json({ url: "https://private.example/account", title: "Fixture", html, status: 200 });
    };
    const result = await fetchReadable("https://private.example/account");
    assert.deepEqual(calls, ["http://127.0.0.1:19377/fetch"]);
    assert.equal(result.llmsTxt, null);
    assert.equal(result.extractor, "proxy");
    assert.match(result.content, /Current rendered content/);
    assert.equal(result.contentType, "text/html");
    const raw = await fetchReadable("https://private.example/account", { format: "html" });
    assert.equal(raw.content, html);
    globalThis.fetch = async () => { throw new Error("gateway down"); };
    await assert.rejects(fetchReadable("https://private.example/account"), /No direct fallback/);
    delete process.env.PI_SEARCH_BROWSER_URL;
    globalThis.fetch = async () => { assert.fail("No request should be made without a gateway configuration"); };
    await assert.rejects(fetchReadable("https://private.example/account"), /No direct request/);
    process.env.PI_SEARCH_FETCH_MODE = "typo";
    await assert.rejects(fetchReadable("https://private.example/account"), /Invalid PI_SEARCH_FETCH_MODE/);
  } finally { globalThis.fetch = original; process.env = env; }
});

test("standalone auto still negotiates markdown and probes llms.txt", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith("llms.txt")) return new Response("# index", { headers: { "content-type": "text/plain" } });
      assert.match((init?.headers as Record<string, string>).Accept, /text\/markdown/);
      return new Response("# Native markdown", { headers: { "content-type": "text/markdown" } });
    };
    const result = await fetchReadable("https://standalone-fixture.example/", { mode: "auto" });
    assert.equal(result.content, "# Native markdown");
    assert.equal(result.llmsTxt, "https://standalone-fixture.example/llms.txt");
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

test("current-tab extraction is pure and retains links/code", () => {
  const result = extractFromHtml(html, "https://fixture.example/", "markdown");
  assert.match(result.content, /example code/);
  assert.match(result.content, /Next/);
});
