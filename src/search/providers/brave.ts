import type { SearchProvider, SearchResult } from "../types";
import { envKey } from "../keys";

const URL = "https://api.search.brave.com/res/v1/web/search";

const FRESHNESS: Record<string, string> = {
  day: "pd",
  week: "pw",
  month: "pm",
  year: "py",
};

/** Brave's general-purpose web search API. */
export const braveProvider: SearchProvider = {
  id: "brave",
  label: "Brave Search",
  kind: "api",

  async resolveKey() {
    return envKey("BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY");
  },

  async search(query, opts, key, signal) {
    const params = new URLSearchParams({
      q: query,
      count: String(opts.maxResults ?? 5),
    });
    if (opts.recency && FRESHNESS[opts.recency]) {
      params.set("freshness", FRESHNESS[opts.recency]);
    }

    const res = await fetch(`${URL}?${params}`, {
      signal,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
    });

    if (!res.ok) {
      throw new Error(`Brave HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          age?: string;
        }>;
      };
    };

    const results: SearchResult[] = (data.web?.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "Untitled",
      url: r.url ?? "",
      snippet: r.description,
      publishedDate: r.age,
    }));

    return { query, provider: "brave", results };
  },
};
