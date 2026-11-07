import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFromHtml } from "../src/fetch/fetch";

test("DOM extraction preserves tabbed commands and relative URLs without running page scripts", () => {
  const key = "__piSearchUntrustedPageExecuted";
  const page = `<!doctype html><html><head><title>Deployment guide</title></head><body>
    <nav>navigation-only-marker</nav>
    <main><h1>Deployment guide</h1>
      <p>${"Read the deployment instructions before starting the synthetic service. ".repeat(40)}</p>
      <div role="tabpanel"><pre><code>docker compose up -d</code></pre></div>
      <a href="../reference?section=commands&amp;lang=en">Command reference</a>
      <div hidden>hidden-content-marker</div>
      <div aria-hidden="true">aria-hidden-marker</div>
      <script>globalThis.${key} = true; throw new Error("must not execute");</script>
    </main><footer>footer-only-marker</footer>
  </body></html>`;
  const result = extractFromHtml(page, "https://fixture.example/docs/install/", "markdown");
  assert.match(result.content, /docker compose up -d/);
  assert.match(result.content, /https:\/\/fixture\.example\/docs\/reference\?section=commands&lang=en/);
  assert.doesNotMatch(result.content, /hidden-content-marker|aria-hidden-marker|navigation-only-marker|footer-only-marker/);
  assert.equal((globalThis as Record<string, unknown>)[key], undefined);
});
