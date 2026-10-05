import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchReadable } from "../src/fetch/fetch";
import { fetchScreenshotSegment } from "../src/fetch/proxies/browser";
import { screenshotDetails, screenshotImage, screenshotNote, validateScreenshot } from "../src/fetch/screenshot";
import { screenshotFixture } from "./screenshot-fixture";

const html = "<html><head><title>Listing</title></head><body><article>Current rendered listing photos</article></body></html>";

function gatewayEnv() {
  process.env.PI_SEARCH_BROWSER_URL = "http://gateway.example";
  process.env.PI_SEARCH_FETCH_MODE = "auto";
  process.env.PI_SEARCH_FETCH_PROXY = "jina";
  delete process.env.PI_SEARCH_BROWSER_TOKEN_FILE;
  delete process.env.PI_SEARCH_BROWSER_TOKEN;
}

test("explicit screenshots force one browser navigation with text and first segment; no direct/probe/hosted requests", async () => {
  const env = { ...process.env }, original = globalThis.fetch;
  try {
    gatewayEnv();
    const calls: string[] = [];
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      assert.equal(init?.redirect, "error");
      assert.equal(JSON.parse(init?.body as string).screenshot, true);
      return Response.json({ html, title: "Listing", url: "https://listing.example/item", screenshot: screenshotFixture() });
    };
    const result = await fetchReadable("https://listing.example/item", { screenshot: true, maxChars: 5 });
    assert.deepEqual(calls, ["http://gateway.example/fetch"]);
    assert.equal(result.content.length, 5);
    assert.equal(result.screenshot?.segment, 1);
    assert.equal(result.llmsTxt, null);
    assert.equal(result.contentType, "text/html");
    const raw = await fetchReadable("https://listing.example/item", { screenshot: true, format: "html" });
    assert.equal(raw.content, html);
    assert.ok(raw.screenshot);
    delete process.env.PI_SEARCH_BROWSER_URL;
    globalThis.fetch = async () => { assert.fail("must not fetch without gateway configuration"); };
    await assert.rejects(fetchReadable("https://listing.example/item", { screenshot: true }), /No direct request/);
  } finally { process.env = env; globalThis.fetch = original; }
});

test("continuation only contacts screenshot storage, never navigates or silently recreates expired captures", async () => {
  const env = { ...process.env }, original = globalThis.fetch;
  try {
    gatewayEnv();
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "http://gateway.example/fetch/screenshot");
      assert.deepEqual(JSON.parse(init?.body as string), { capture_id: screenshotFixture().capture_id, segment: 2 });
      return Response.json(screenshotFixture(2));
    };
    assert.equal((await fetchScreenshotSegment(screenshotFixture().capture_id, 2)).segment, 2);
    globalThis.fetch = async () => { calls++; return Response.json({ code: "screenshot_unavailable", error: "capture expired" }, { status: 410 }); };
    await assert.rejects(fetchScreenshotSegment(screenshotFixture().capture_id, 2), /capture expired/);
    assert.equal(calls, 2);
    await assert.rejects(fetchScreenshotSegment("bad-id", 1), /valid captureId/);
    await assert.rejects(fetchScreenshotSegment(screenshotFixture().capture_id, 0), /segment number/);
    await assert.rejects(fetchScreenshotSegment(screenshotFixture().capture_id, 1.5), /segment number/);
    assert.equal(calls, 2);
    globalThis.fetch = async () => Response.json(screenshotFixture(1));
    await assert.rejects(fetchScreenshotSegment(screenshotFixture().capture_id, 2), /different screenshot segment/);
  } finally { process.env = env; globalThis.fetch = original; }
});

test("old gateways, auth failures, redirects and cancellation fail closed", async () => {
  const env = { ...process.env }, original = globalThis.fetch;
  try {
    gatewayEnv();
    globalThis.fetch = async () => Response.json({ html, url: "https://listing.example/item" });
    await assert.rejects(fetchReadable("https://listing.example/item", { screenshot: true }), /Upgrade browser-fetch/);
    globalThis.fetch = async () => Response.json({ error: "unknown screenshot field", code: "bad_request" }, { status: 400 });
    await assert.rejects(fetchReadable("https://listing.example/item", { screenshot: true }), /Upgrade browser-fetch/);
    globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
    await assert.rejects(fetchScreenshotSegment(screenshotFixture().capture_id, 1), /rejected the token/);
    globalThis.fetch = async (_url, init) => { assert.equal(init?.redirect, "error"); throw new Error("redirect refused"); };
    await assert.rejects(fetchReadable("https://listing.example/item", { screenshot: true }), /No direct fallback/);
    const controller = new AbortController(); controller.abort();
    globalThis.fetch = async (_url, init) => { assert.ok(init?.signal?.aborted); throw new Error("aborted"); };
    await assert.rejects(fetchScreenshotSegment(screenshotFixture().capture_id, 1, controller.signal), /aborted/);
  } finally { process.env = env; globalThis.fetch = original; }
});

test("screenshot protocol bounds and checksums are validated; details do not duplicate base64", () => {
  const good = screenshotFixture();
  assert.equal(validateScreenshot(good), good);
  assert.equal(screenshotImage(good).type, "image");
  assert.equal("data" in screenshotDetails(good).image, false);
  assert.match(screenshotNote(good), /segment=2/);
  assert.match(screenshotNote({ ...good, truncated: true }), /NOT included/);
  for (const bad of [undefined, { ...good, version: 2 }, { ...good, segments: 100 }, { ...good, captured_height: 12001 },
    { ...good, image: { ...good.image, width: 1281 } }, { ...good, image: { ...good.image, bytes: 393217 } },
    { ...good, image: { ...good.image, data: "A".repeat(524289) } }, { ...good, image: { ...good.image, data: "garbage" } },
    { ...good, image: { ...good.image, sha256: "0".repeat(64) } }, { ...good, image: { ...good.image, bytes: 10 } },
    { ...good, y_end: 2701 }, { ...good, segment: 3 }]) {
    assert.throws(() => validateScreenshot(bad));
  }
});

test("continuation wire response byte budget is enforced", async () => {
  const env = { ...process.env }, original = globalThis.fetch;
  try {
    gatewayEnv();
    globalThis.fetch = async () => new Response("x".repeat(1024 * 1024 + 1));
    await assert.rejects(fetchScreenshotSegment(screenshotFixture().capture_id, 1), /response exceeds byte limit/);
  } finally { process.env = env; globalThis.fetch = original; }
});
