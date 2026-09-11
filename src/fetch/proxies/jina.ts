/**
 * Jina AI Reader proxy (r.jina.ai).
 *
 * Hosted service that fetches with headless Chrome or curl-impersonate (browser
 * TLS fingerprint) and returns Markdown. Free without a key at 20 req/min;
 * Apache-2.0 and self-hostable (github.com/jina-ai/reader).
 *
 *   PI_SEARCH_FETCH_PROXY=jina
 *   JINA_API_KEY=…    optional; raises rate limits
 *
 * We send `DNT: 1`, Jina's "do not cache or log this request" signal. Note the
 * target URL is still disclosed to a third party — hence opt-in.
 */
import { ProxyTargetBlockedError, type ProxyResult, type ReaderProxy } from "./types";

export const jinaProxy: ReaderProxy = {
  id: "jina",

  label() {
    return "r.jina.ai";
  },

  unavailable() {
    return null; // usable without a key
  },

  async fetch(url, signal): Promise<ProxyResult> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Return-Format": "markdown",
      // Ask Jina not to cache or log this URL.
      DNT: "1",
      "User-Agent": "pi-search (+https://github.com/earendil-works/pi)",
    };
    const key = process.env.JINA_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;

    const res = await fetch(`https://r.jina.ai/${url}`, { signal, headers });
    if (!res.ok) {
      throw new Error(`reader proxy r.jina.ai returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: {
        title?: string;
        content?: string;
        url?: string;
        httpStatus?: number;
        warning?: string;
      };
    };
    const data = body.data ?? {};
    // Jina reports the *target's* failure inside a 200 envelope.
    if ((data.httpStatus ?? 200) >= 400 || /returned error \d{3}/.test(data.warning ?? "")) {
      const status = data.httpStatus ?? Number(/error (\d{3})/.exec(data.warning ?? "")?.[1] ?? 403);
      throw new ProxyTargetBlockedError(status, data.warning ?? `target returned HTTP ${status}`);
    }
    const content = (data.content ?? "").trim();
    if (!content) throw new Error("reader proxy r.jina.ai returned no content");
    return { title: data.title?.trim() || null, url: data.url ?? null, content };
  },
};
