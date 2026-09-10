/**
 * Readable web fetch — retrieve a URL and return LLM-friendly content.
 *
 * Originally ported from the 2h-team/wiki browser tool (jsdom + Mozilla
 * Readability). Now agent-aware:
 *
 *  - Content negotiation: sends `Accept: text/markdown, …` so servers that
 *    publish Markdown for agents (grafana.com, Mintlify-hosted docs, Cloudflare,
 *    Vercel, …) return it natively. Same behaviour as Claude Code / OpenCode.
 *  - `<link rel="alternate" type="text/markdown">`: when an HTML page advertises
 *    a Markdown twin, fetch that instead (one hop).
 *  - HTML → Markdown: Readability isolates the main article, then Turndown
 *    (+GFM) converts it, preserving headings, lists, fenced code and links.
 *    The old behaviour (`article.textContent`) dropped every hyperlink.
 *  - Body fallback: when Readability keeps only a sliver of the page (marketing
 *    pages, card grids), convert the largest `<main>`/`<article>`/body instead.
 *  - `llms.txt` hint: probes `<origin>/llms.txt` once per origin so the agent
 *    learns when a site has a curated machine-readable docs index.
 *  - JSON / plain text / Markdown pass through unchanged.
 */
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";
// turndown-plugin-gfm ships no types.
// @ts-expect-error
import { gfm } from "turndown-plugin-gfm";

const DEFAULT_MAX_CHARS = 50_000;
const USER_AGENT = "pi-search/0.4 (+https://github.com/earendil-works/pi)";
const LLMS_TXT_TIMEOUT_MS = 3_000;
/** Readability output shorter than this fraction of the body text is treated as a miss. */
const READABILITY_MIN_RATIO = 0.2;
const BODY_FALLBACK_MIN_CHARS = 1_500;

export type FetchFormat = "markdown" | "text" | "html";

export type Extractor =
  | "markdown" // server returned text/markdown natively
  | "alternate" // followed <link rel=alternate type=text/markdown>
  | "readability" // HTML → Readability (→ Turndown for markdown format)
  | "body" // Readability kept too little; converted <main>/<article>/body
  | "naive" // tag-stripping fallback
  | "raw"; // passed through unchanged (JSON, text, or format=html)

export interface FetchOptions {
  maxChars?: number;
  format?: FetchFormat;
  signal?: AbortSignal;
}

export interface FetchResult {
  /** Final URL after redirects. */
  url: string;
  requestedUrl: string;
  contentType: string;
  format: FetchFormat;
  extractor: Extractor;
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  /** URL of the origin's llms.txt, when one exists. */
  llmsTxt: string | null;
  content: string;
  length: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Content negotiation
// ---------------------------------------------------------------------------

const ACCEPT: Record<FetchFormat, string> = {
  markdown:
    "text/markdown;q=1.0, text/x-markdown;q=0.9, text/html;q=0.8, application/xhtml+xml;q=0.8, " +
    "application/json;q=0.7, text/plain;q=0.7, */*;q=0.5",
  text:
    "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, application/xhtml+xml;q=0.8, " +
    "application/json;q=0.7, */*;q=0.5",
  // No text/markdown here: some servers (grafana.com) ignore q-values and serve
  // Markdown whenever the type appears at all.
  html: "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.7, application/json;q=0.6, */*;q=0.5",
};

const isMarkdownType = (ct: string): boolean =>
  ct.includes("text/markdown") || ct.includes("text/x-markdown");
const isHtmlType = (ct: string): boolean =>
  ct.includes("text/html") || ct.includes("application/xhtml");

async function doFetch(url: string, format: FetchFormat, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, {
      signal,
      redirect: "follow",
      headers: { Accept: ACCEPT[format], "User-Agent": USER_AGENT },
    });
  } catch (e) {
    throw new Error(`web_fetch: failed to fetch ${url} — ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// HTML → Markdown
// ---------------------------------------------------------------------------

let turndown: TurndownService | undefined;
function htmlToMarkdown(html: string): string {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
    });
    turndown.use(gfm);
    turndown.remove(["script", "style", "noscript", "template"]);
  }
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

const normalizeWs = (s: string): string => s.replace(/\s+/g, " ").trim();

/** `title:` from a leading YAML front-matter block, if present. */
function frontMatterTitle(markdown: string): string | null {
  if (!markdown.startsWith("---")) return null;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return null;
  const m = markdown.slice(3, end).match(/^title:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim().replace(/^(["'])(.*)\1$/, "$2") || null;
}

/** Resolve relative href/src attributes so Markdown links work out of context. */
function absolutizeUrls(root: Element, baseUrl: string): void {
  for (const [selector, attr] of [
    ["a[href]", "href"],
    ["img[src]", "src"],
  ] as const) {
    for (const el of root.querySelectorAll(selector)) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      try {
        el.setAttribute(attr, new URL(v, baseUrl).href);
      } catch {
        /* leave as-is */
      }
    }
  }
}

/** Largest of <main>/<article>/[role=main], or <body> if none holds most of the text. */
function pickContentRoot(doc: Document): { root: Element; textLength: number } {
  for (const el of doc.querySelectorAll(
    "script,style,noscript,template,nav,header,footer,iframe,svg,[aria-hidden=true],[hidden]",
  )) {
    el.remove();
  }
  const bodyLen = normalizeWs(doc.body?.textContent ?? "").length;
  let root: Element = doc.body;
  let best = 0;
  for (const c of doc.querySelectorAll("main,[role=main],article")) {
    const len = normalizeWs(c.textContent ?? "").length;
    if (len > best) {
      best = len;
      root = c;
    }
  }
  if (best < bodyLen * 0.5) {
    root = doc.body;
    best = bodyLen;
  }
  return { root, textLength: best };
}

interface Extracted {
  content: string;
  extractor: Extractor;
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  siteName: string | null;
  /** Markdown twin advertised by the page, if any. */
  alternate: string | null;
}

function findMarkdownAlternate(doc: Document, baseUrl: string): string | null {
  const link = doc.querySelector('link[rel~="alternate"][type="text/markdown"]');
  const href = link?.getAttribute("href");
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function extractFromHtml(html: string, url: string, format: Exclude<FetchFormat, "html">): Extracted {
  const virtualConsole = new VirtualConsole(); // silence jsdom CSS/JS parse noise
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = dom.window.document;
  const alternate = findMarkdownAlternate(doc, url);
  const title = doc.querySelector("title")?.textContent?.trim() || null;

  const bodyTextLen = normalizeWs(doc.body?.textContent ?? "").length;

  let article: ReturnType<Readability["parse"]> = null;
  try {
    // Readability mutates the document; parse a clone so the fallback sees the original.
    article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 500 }).parse();
  } catch {
    article = null;
  }

  const articleText = article?.textContent?.trim() ?? "";
  const readabilityOk =
    articleText.length > 0 &&
    (bodyTextLen < BODY_FALLBACK_MIN_CHARS || articleText.length >= bodyTextLen * READABILITY_MIN_RATIO);

  if (article && readabilityOk) {
    return {
      content:
        format === "markdown"
          ? htmlToMarkdown(article.content ?? "")
          : naiveStripHtml(article.content ?? "") || articleText,
      extractor: "readability",
      title: article.title ?? title,
      byline: article.byline ?? null,
      excerpt: article.excerpt ?? null,
      siteName: article.siteName ?? null,
      alternate,
    };
  }

  const { root, textLength } = pickContentRoot(doc);
  if (textLength >= BODY_FALLBACK_MIN_CHARS || (textLength > 0 && articleText.length === 0)) {
    absolutizeUrls(root, url);
    return {
      content: format === "markdown" ? htmlToMarkdown(root.innerHTML) : naiveStripHtml(root.innerHTML),
      extractor: "body",
      title,
      byline: null,
      excerpt: null,
      siteName: null,
      alternate,
    };
  }

  return {
    content: naiveStripHtml(html),
    extractor: "naive",
    title,
    byline: null,
    excerpt: null,
    siteName: null,
    alternate,
  };
}

// ---------------------------------------------------------------------------
// llms.txt discovery
// ---------------------------------------------------------------------------

const llmsTxtCache = new Map<string, Promise<string | null>>();

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Returns the llms.txt URL for `origin` if it exists (cached per origin, never throws). */
export function probeLlmsTxt(origin: string, signal?: AbortSignal): Promise<string | null> {
  const cached = llmsTxtCache.get(origin);
  if (cached) return cached;
  const url = `${origin}/llms.txt`;
  const p = (async (): Promise<string | null> => {
    try {
      const res = await fetch(url, {
        signal: withTimeout(signal, LLMS_TXT_TIMEOUT_MS),
        redirect: "follow",
        // Deliberately no text/markdown: grafana.com's Markdown middleware 404s
        // /llms.txt when asked for it, since there is no .md twin of that path.
        headers: { Accept: "text/plain, */*;q=0.5", "User-Agent": USER_AGENT },
      });
      await res.body?.cancel();
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      // Soft-404s return 200 text/html; a real llms.txt is text/plain or text/markdown.
      return res.ok && (ct.includes("text/plain") || isMarkdownType(ct)) ? url : null;
    } catch {
      return null;
    }
  })();
  llmsTxtCache.set(origin, p);
  return p;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function fetchReadable(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  if (!url || typeof url !== "string") {
    throw new Error("web_fetch: `url` must be a non-empty string");
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("web_fetch: URL must start with http:// or https://");
  }
  const format: FetchFormat = opts.format ?? "markdown";
  const { signal } = opts;

  // Fire the llms.txt probe alongside the main fetch; it's cached per origin.
  const llmsTxtPromise = probeLlmsTxt(new URL(url).origin, signal);

  const response = await doFetch(url, format, signal);
  if (!response.ok) {
    throw new Error(`web_fetch: ${url} returned HTTP ${response.status}`);
  }

  const finalUrl = response.url || url;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const cleanType = contentType.split(";")[0].trim();
  const rawText = await response.text();

  let content: string;
  let extractor: Extractor = "raw";
  let title: string | null = null;
  let byline: string | null = null;
  let excerpt: string | null = null;
  let siteName: string | null = null;

  if (isMarkdownType(contentType)) {
    content = rawText;
    extractor = "markdown";
    title = frontMatterTitle(rawText);
  } else if (isHtmlType(contentType) && format !== "html") {
    const extracted = extractFromHtml(rawText, finalUrl, format);
    content = extracted.content;
    extractor = extracted.extractor;
    title = extracted.title;
    byline = extracted.byline;
    excerpt = extracted.excerpt;
    siteName = extracted.siteName;

    // The page advertises a Markdown twin the server didn't negotiate to — prefer it.
    if (format === "markdown" && extracted.alternate && extracted.alternate !== finalUrl) {
      try {
        const alt = await doFetch(extracted.alternate, "markdown", signal);
        const altType = (alt.headers.get("content-type") || "").toLowerCase();
        if (alt.ok && !isHtmlType(altType)) {
          const altText = await alt.text();
          if (altText.trim().length > 0) {
            content = altText;
            extractor = "alternate";
            title = frontMatterTitle(altText) ?? title;
          }
        }
      } catch {
        /* keep the Readability result */
      }
    }
  } else {
    content = rawText;
    extractor = "raw";
  }

  const llmsTxt = await llmsTxtPromise;

  const limit = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const truncated = content.length > limit;
  if (truncated) content = content.slice(0, limit);

  return {
    url: finalUrl,
    requestedUrl: url,
    contentType: cleanType,
    format,
    extractor,
    title,
    byline,
    siteName,
    excerpt,
    llmsTxt,
    content,
    length: content.length,
    truncated,
  };
}
