import type { SearchProvider, SearchResult } from "../types";
import { foundationKey, envKey } from "../keys";

const URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Foundation-model search via OpenAI's Responses API hosted `web_search`
 * tool. We return the model's output text as the answer and url_citation
 * annotations as citations.
 */
export const openaiProvider: SearchProvider = {
  id: "openai",
  label: "OpenAI (web_search)",
  kind: "foundation",
  piProvider: "openai",

  resolveKey(ctx) {
    return foundationKey(ctx, "openai", "OPENAI_API_KEY");
  },

  async search(query, _opts, key, signal) {
    const model = envKey("PI_SEARCH_MODEL") ?? DEFAULT_MODEL;

    const res = await fetch(URL, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search" }],
        input: query,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI web_search HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      output?: Array<Record<string, any>>;
      output_text?: string;
    };

    const answerParts: string[] = [];
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const item of data.output ?? []) {
      if (item.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && typeof part.text === "string") {
          answerParts.push(part.text);
        }
        for (const ann of part.annotations ?? []) {
          if (ann.type !== "url_citation" || !ann.url) continue;
          if (seen.has(ann.url)) continue;
          seen.add(ann.url);
          results.push({ title: String(ann.title ?? ann.url), url: String(ann.url) });
        }
      }
    }

    const answer = (data.output_text ?? answerParts.join("")).trim();

    return {
      query,
      provider: "openai",
      answer: answer || undefined,
      results,
    };
  },
};
