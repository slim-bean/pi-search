import type { SearchProvider, SearchResult } from "../types";
import { envKey } from "../keys";
import { recencyToDays } from "../types";

const URL = "https://api.tavily.com/search";

/** Dedicated agent-focused search API. Returns a synthesized answer + sources. */
export const tavilyProvider: SearchProvider = {
  id: "tavily",
  label: "Tavily",
  kind: "api",

  async resolveKey() {
    return envKey("TAVILY_API_KEY");
  },

  async search(query, opts, key, signal) {
    const res = await fetch(URL, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: opts.maxResults ?? 5,
        search_depth: "basic",
        include_answer: true,
        days: recencyToDays(opts.recency),
      }),
    });

    if (!res.ok) {
      throw new Error(`Tavily HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      answer?: string;
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
        published_date?: string;
      }>;
    };

    const results: SearchResult[] = (data.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "Untitled",
      url: r.url ?? "",
      content: r.content,
      score: r.score,
      publishedDate: r.published_date,
    }));

    return {
      query,
      provider: "tavily",
      answer: data.answer?.trim() || undefined,
      results,
    };
  },
};
