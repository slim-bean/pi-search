/** Current-tab reading: pi-devtools owns the tab, pi-search owns extraction. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { extractFromHtml } from "./fetch";

export function registerBrowserRead(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser_read", label: "Read Browser Page", executionMode: "sequential",
    description: "Read the current live browser tab as Markdown without navigating, reloading, or opening another tab. " +
      "Preserves the page's current authenticated and interactive state. Uses the same extraction as web_fetch. " +
      "For app controls, forms, or content omitted by article extraction, use browser_dom instead. Requires pi-devtools.",
    promptSnippet: "Read the current live tab as Markdown without another fetch",
    promptGuidelines: ["Use browser_read to read a page already open or modified through browser_interact; web_fetch loads a separate page."],
    parameters: Type.Object({ maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000, description: "Output character limit (default 50000)." })) }),
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      const request: { result?: Promise<{ html: string; url: string; title: string }> } = {};
      pi.events.emit("pi-devtools:snapshot:v1", request);
      if (!request.result) throw new Error("browser_read requires pi-devtools. Install/enable it and reload pi.");
      const page = await request.result;
      signal?.throwIfAborted();
      const result = extractFromHtml(page.html, page.url, "markdown");
      const max = params.maxChars ?? 50_000;
      const truncated = result.content.length > max;
      const content = result.content.slice(0, max);
      return {
        content: [{ type: "text", text: `# ${page.title || result.title || "Browser page"}\nURL: ${page.url}\nExtractor: ${result.extractor}${truncated ? " (truncated)" : ""}\n\n${content}` }],
        details: { url: page.url, title: page.title, extractor: result.extractor, truncated },
      };
    },
  });
}
