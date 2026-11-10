import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFromHtml } from "../src/fetch/fetch";

test("Markdown joining preserves every sibling and inline boundary in a long document", () => {
  // Turndown 7.2.5 replaces string concatenation with an array accumulator.
  // Empty inline nodes and block separators must not lose or merge prior parts.
  const paragraphs = Array.from({ length: 128 }, (_, i) => ({
    html: `<p>Section ${i}: <strong>important</strong><span></span> text and <em>detail</em>.</p>`,
    markdown: `Section ${i}: **important** text and *detail*.`,
  }));
  const result = extractFromHtml(`<html><body><main>${paragraphs.map((p) => p.html).join("\n")}</main></body></html>`,
    "https://fixture.example/guide", "markdown");
  assert.equal(result.content, paragraphs.map((p) => p.markdown).join("\n\n"));
});

test("Markdown block joins preserve fenced code, lists, and GFM tables", () => {
  const result = extractFromHtml(`<html><body><main>
    <p>Before <a href="/reference">reference</a>.</p>
    <pre><code>echo one\necho two</code></pre>
    <ul><li>First</li><li>Second</li></ul>
    <table><thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody><tr><td>mode</td><td>safe</td></tr></tbody></table>
    <p>After.</p>
  </main></body></html>`, "https://fixture.example/guide", "markdown");
  assert.match(result.content, /Before \[reference\]\(https:\/\/fixture\.example\/reference\)\./);
  assert.match(result.content, /```\necho one\necho two\n```/);
  assert.match(result.content, /- +First\n- +Second/);
  assert.match(result.content, /\| Name \| Value \|\n\| --- \| --- \|\n\| mode \| safe \|/);
  assert.match(result.content, /\n\nAfter\.$/);
});

test("HTML parser upgrades preserve entities, omitted end tags, and multilingual text", () => {
  // Exercise jsdom/parse5/entities through the actual extraction pipeline, not
  // just JSDOM construction. Browsers repair these omitted closing tags.
  const html = `<html lang="fr-CA"><head><title>Guide &amp; r&eacute;f&eacute;rence</title></head>
    <body><main><h1>Guide &amp; r&eacute;f&eacute;rence</h1>
    <p>Fran&ccedil;ais &#x1F680; &lt;config&gt;<p>Deuxi&egrave;me paragraphe
    <ul><li>premier &amp; second<li>日本語</ul>
    <p><a href="../r%C3%A9f?one=1&amp;two=2">R&eacute;f&eacute;rence</a></main></body></html>`;
  const result = extractFromHtml(html, "https://fixture.example/docs/install/", "markdown");
  assert.notEqual(result.extractor, "naive");
  assert.match(result.content, /Français 🚀 <config>\n\nDeuxième paragraphe/);
  assert.match(result.content, /- +premier & second\n- +日本語/);
  assert.match(result.content, /\[Référence\]\(https:\/\/fixture\.example\/docs\/r%C3%A9f\?one=1&two=2\)/);
  assert.doesNotMatch(result.content, /&(?:amp|eacute|ccedil);/);
});

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
