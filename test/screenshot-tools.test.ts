import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTools } from "./tool-harness";
import { screenshotFixture } from "./screenshot-fixture";

test("registered tools return image attachments plus continuation instructions, with text-only backwards compatibility", async () => {
  const tools = await loadTools();
  const web = tools.get("web_fetch")!, continuation = tools.get("web_fetch_screenshot")!;
  assert.equal(web.parameters.properties.screenshot.type, "boolean");
  assert.equal(continuation.parameters.properties.segment.minimum, 1);
  const env = { ...process.env }, original = globalThis.fetch;
  try {
    process.env.PI_SEARCH_FETCH_MODE = "browser-only";
    process.env.PI_SEARCH_BROWSER_URL = "http://fixture-gateway.example";
    delete process.env.PI_SEARCH_BROWSER_TOKEN_FILE;
    delete process.env.PI_SEARCH_BROWSER_TOKEN;
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      const body = JSON.parse(init!.body as string);
      if (String(url).endsWith("/screenshot")) return Response.json(screenshotFixture(body.segment));
      return Response.json({ url: "https://listing.example/item", html: "<body><article>Listing content</article></body>", ...(body.screenshot ? { screenshot: screenshotFixture() } : {}) });
    };
    const first = await web.execute("test", { url: "https://listing.example/item", screenshot: true });
    assert.deepEqual(first.content.map((c: any) => c.type), ["text", "image"]);
    assert.match(first.content[0].text, /Listing content/);
    assert.match(first.content[0].text, /web_fetch_screenshot/);
    assert.equal(first.content[1].mimeType, "image/jpeg");
    assert.equal("data" in first.details.screenshot.image, false);
    const second = await continuation.execute("test", { captureId: first.details.screenshot.capture_id, segment: 2 });
    assert.deepEqual(second.content.map((c: any) => c.type), ["text", "image"]);
    assert.equal(second.details.segment, 2);
    assert.equal("data" in second.details.image, false);
    const text = await web.execute("test", { url: "https://listing.example/item" });
    assert.equal(text.content.length, 1);
    assert.equal(text.details.screenshot, undefined);
    assert.equal(calls, 3);
  } finally { process.env = env; globalThis.fetch = original; }
});
