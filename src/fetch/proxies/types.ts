/**
 * Reader proxies: fallbacks used when a direct fetch is blocked.
 *
 * A proxy either returns Markdown directly (hosted readers like Jina) or the
 * rendered HTML of the page (the browser gateway), in which case web_fetch runs
 * its normal Readability → Turndown pipeline over it so output shape is
 * identical to a direct fetch.
 */

export interface ProxyResult {
  title: string | null;
  /** Final URL as seen by the proxy, if reported. */
  url: string | null;
  /** Markdown, when the proxy already converted the page. */
  content?: string;
  /** Rendered HTML, when the proxy returns raw markup. */
  html?: string;
}

/** The proxy reached the target, but the target refused it too. */
export class ProxyTargetBlockedError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly vendor?: string,
  ) {
    super(message);
    this.name = "ProxyTargetBlockedError";
  }
}

export interface ReaderProxy {
  id: string;
  /** Shown in the tool header, e.g. `Extractor: proxy (browser 127.0.0.1:8377)`. */
  label(): string;
  /** Why this proxy cannot be used right now, or null when it is usable. */
  unavailable(): string | null;
  fetch(url: string, signal?: AbortSignal): Promise<ProxyResult>;
}
