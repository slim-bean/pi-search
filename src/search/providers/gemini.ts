import type { SearchProvider, SearchResult } from "../types";
import { foundationKey, envKey } from "../keys";

const DEFAULT_MODEL = "gemini-2.0-flash";

/**
 * Foundation-model search via Google Gemini's Search grounding tool. We
 * return the grounded answer text and the grounding chunks as citations.
 */
export const geminiProvider: SearchProvider = {
  id: "gemini",
  label: "Google Gemini (search grounding)",
  kind: "foundation",
  piProvider: "google",

  resolveKey(ctx) {
    return foundationKey(ctx, "google", "GEMINI_API_KEY", "GOOGLE_API_KEY");
  },

  async search(query, _opts, key, signal) {
    const model = envKey("PI_SEARCH_MODEL") ?? DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "x-goog-api-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini search HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      }>;
    };

    const candidate = data.candidates?.[0];
    const answer = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
      const uri = chunk.web?.uri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      results.push({ title: chunk.web?.title ?? uri, url: uri });
    }

    return {
      query,
      provider: "gemini",
      answer: answer || undefined,
      results,
    };
  },
};
