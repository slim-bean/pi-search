/**
 * Readable web fetch — retrieve a URL and return clean, readable content.
 *
 * Ported from the 2h-team/wiki browser tool, adapted for Node:
 *  - Uses jsdom (instead of the browser DOMParser) to build a document.
 *  - Runs Mozilla's Readability over HTML to extract the main article text
 *    (same algorithm as Firefox Reader View), dropping nav/sidebar/ads.
 *  - Falls back to naive tag-stripping when Readability finds no article.
 *  - JSON and plain text are passed through unchanged.
 *
 * Unlike the wiki version there is no CORS proxy: pi runs in Node, so we
 * fetch URLs directly.
 */
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

const DEFAULT_MAX_CHARS = 50_000;

export interface FetchResult {
  url: string;
  contentType: string;
  extractor: "readability" | "naive" | "raw";
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string;
  length: number;
  truncated: boolean;
}

function extractReadable(
  html: string,
  sourceUrl: string,
): {
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  textContent: string;
  siteName: string | null;
} | null {
  try {
    // Silence noisy jsdom CSS/JS parse errors from real-world pages.
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, { url: sourceUrl, virtualConsole });
    const reader = new Readability(dom.window.document, { charThreshold: 500 });
    const article = reader.parse();
    if (!article || !article.textContent) return null;
    return {
      title: article.title ?? null,
      byline: article.byline ?? null,
      excerpt: article.excerpt ?? null,
      textContent: article.textContent.trim(),
      siteName: article.siteName ?? null,
    };
  } catch {
    return null;
  }
}

function naiveStripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "• ");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}

export async function fetchReadable(
  url: string,
  maxChars: number | undefined,
  signal: AbortSignal | undefined,
): Promise<FetchResult> {
  if (!url || typeof url !== "string") {
    throw new Error("web_fetch: `url` must be a non-empty string");
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("web_fetch: URL must start with http:// or https://");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: {
        Accept: "text/html, application/json, text/plain, */*",
        "User-Agent": "pi-search/0.1 (+https://github.com/earendil-works/pi)",
      },
    });
  } catch (e) {
    throw new Error(`web_fetch: failed to fetch ${url} — ${(e as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`web_fetch: ${url} returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();
  const cleanType = contentType.split(";")[0].trim();

  let content: string;
  let title: string | null = null;
  let byline: string | null = null;
  let excerpt: string | null = null;
  let siteName: string | null = null;
  let extractor: FetchResult["extractor"] = "raw";

  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    const article = extractReadable(rawText, url);
    if (article) {
      content = article.textContent;
      title = article.title;
      byline = article.byline;
      excerpt = article.excerpt;
      siteName = article.siteName;
      extractor = "readability";
    } else {
      content = naiveStripHtml(rawText);
      extractor = "naive";
    }
  } else {
    content = rawText;
    extractor = "raw";
  }

  const limit = maxChars ?? DEFAULT_MAX_CHARS;
  const truncated = content.length > limit;
  if (truncated) content = content.slice(0, limit);

  return {
    url,
    contentType: cleanType,
    extractor,
    title,
    byline,
    siteName,
    excerpt,
    content,
    length: content.length,
    truncated,
  };
}
