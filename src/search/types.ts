import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** How recent results should be, mapped per-provider where supported. */
export type Recency = "day" | "week" | "month" | "year";

export interface SearchOptions {
  /** Max number of results to return. */
  maxResults?: number;
  /** Restrict to recent results, where the provider supports it. */
  recency?: Recency;
}

export interface SearchResult {
  title: string;
  url: string;
  /** Short description / snippet. */
  snippet?: string;
  /** Fuller extracted content, when the provider returns it. */
  content?: string;
  /** ISO-ish published date string, when available. */
  publishedDate?: string;
  /** Provider relevance score, when available. */
  score?: number;
}

export interface SearchResponse {
  query: string;
  provider: string;
  /** Synthesized answer (foundation-model providers, Tavily). */
  answer?: string;
  results: SearchResult[];
}

/**
 * A pluggable web-search backend. Two kinds:
 *  - "foundation": uses a foundation model's built-in web search, reusing
 *    pi's configured API keys via ctx.modelRegistry.
 *  - "api": a dedicated search API keyed by an environment variable.
 */
export interface SearchProvider {
  /** Stable id used for selection (e.g. "anthropic", "tavily"). */
  id: string;
  /** Human label for UI. */
  label: string;
  kind: "foundation" | "api";
  /**
   * Resolve the API key for this provider, or undefined if unavailable.
   * Foundation providers should reuse ctx.modelRegistry; API providers read env.
   */
  resolveKey(ctx: ExtensionContext): Promise<string | undefined>;
  /** Run a search. Throws on error. */
  search(
    query: string,
    opts: SearchOptions,
    key: string,
    signal: AbortSignal | undefined,
  ): Promise<SearchResponse>;
}

/** Map a recency window to an approximate number of days. */
export function recencyToDays(recency: Recency | undefined): number | undefined {
  switch (recency) {
    case "day":
      return 1;
    case "week":
      return 7;
    case "month":
      return 30;
    case "year":
      return 365;
    default:
      return undefined;
  }
}
