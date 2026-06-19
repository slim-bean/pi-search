import type { SearchProvider, SearchResult } from "../types";
import { envKey } from "../keys";
import { recencyToDays } from "../types";

const URL = "https://api.exa.ai/search";

/** Exa neural/semantic search; can also return page contents. */
export const exaProvider: SearchProvider = {
  id: "exa",
  label: "Exa",
  kind: "api",

  async resolveKey() {
    return envKey("EXA_API_KEY");
  },

  async search(query, opts, key, signal) {
    const days = recencyToDays(opts.recency);
    const startPublishedDate = days
      ? new Date(Date.now() - days * 86_400_000).toISOString()
      : undefined;

    const res = await fetch(URL, {
      method: "POST",
      signal,
      headers: {
        "x-api-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        numResults: opts.maxResults ?? 5,
        contents: { text: { maxCharacters: 2000 } },
        startPublishedDate,
      }),
    });

    if (!res.ok) {
      throw new Error(`Exa HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        text?: string;
        publishedDate?: string;
        score?: number;
      }>;
    };

    const results: SearchResult[] = (data.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "Untitled",
      url: r.url ?? "",
      content: r.text,
      publishedDate: r.publishedDate,
      score: r.score,
    }));

    return { query, provider: "exa", results };
  },
};
