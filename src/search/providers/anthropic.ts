import type { SearchProvider, SearchResult } from "../types";
import { foundationKey, envKey } from "../keys";

const URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * Foundation-model search via Anthropic's server-side `web_search_20250305`
 * tool. The model runs searches autonomously; we return its synthesized
 * answer plus the raw web_search results as citations.
 */
export const anthropicProvider: SearchProvider = {
  id: "anthropic",
  label: "Anthropic (web_search)",
  kind: "foundation",

  resolveKey(ctx) {
    return foundationKey(ctx, "anthropic", "ANTHROPIC_API_KEY");
  },

  async search(query, opts, key, signal) {
    const model = envKey("PI_SEARCH_MODEL") ?? DEFAULT_MODEL;
    const maxUses = Math.max(1, Math.min(opts.maxResults ?? 5, 10));

    const res = await fetch(URL, {
      method: "POST",
      signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: query }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic web_search HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      content?: Array<Record<string, unknown>>;
    };

    const answerParts: string[] = [];
    const results: SearchResult[] = [];

    for (const block of data.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        answerParts.push(block.text);
      } else if (block.type === "web_search_tool_result") {
        const items = (block.content as Array<Record<string, unknown>>) ?? [];
        for (const item of items) {
          if (item.type !== "web_search_result") continue;
          results.push({
            title: String(item.title ?? item.url ?? "Untitled"),
            url: String(item.url ?? ""),
            publishedDate: item.page_age ? String(item.page_age) : undefined,
          });
        }
      }
    }

    return {
      query,
      provider: "anthropic",
      answer: answerParts.join("").trim() || undefined,
      results,
    };
  },
};
