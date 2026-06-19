import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

import { resolveProvider, listAvailable, getProvider, PROVIDERS } from "./search/registry";
import { formatSearchResponse } from "./search/format";
import { fetchReadable } from "./fetch/fetch";

const searchParameters = Type.Object({
  query: Type.String({ description: "The search query." }),
  maxResults: Type.Optional(
    Type.Number({ description: "Maximum number of results to return (default 5)." }),
  ),
  recency: Type.Optional(
    StringEnum(["day", "week", "month", "year"] as const, {
      description: "Restrict to recent results, where the provider supports it.",
    }),
  ),
});

const fetchParameters = Type.Object({
  url: Type.String({ description: "The http(s) URL to fetch." }),
  maxChars: Type.Optional(
    Type.Number({ description: "Truncate returned content to this many characters (default 50000)." }),
  ),
});

export default function (pi: ExtensionAPI) {
  pi.registerFlag("search-provider", {
    description: "Web search provider id (auto|anthropic|openai|gemini|tavily|brave|exa)",
    type: "string",
  });

  // Selection precedence: CLI flag > /search-provider command > env > auto.
  let selected: string =
    (pi.getFlag("search-provider") as string | undefined) ??
    process.env.PI_SEARCH_PROVIDER ??
    "auto";

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information. Returns a synthesized answer " +
      "(for foundation-model and Tavily providers) plus a list of source URLs. " +
      "Use web_fetch to read the full content of a result.",
    promptSnippet: "Search the web for current information and source URLs",
    promptGuidelines: [
      "Use web_search when the user asks about current events, recent releases, or anything that may be newer than your training data.",
      "After web_search, use web_fetch to read promising source URLs in full before relying on them.",
    ],
    parameters: searchParameters,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { provider, key } = await resolveProvider(ctx as ExtensionContext, selected);
      onUpdate?.({ content: [{ type: "text", text: `Searching via ${provider.label}…` }] });

      const resp = await provider.search(
        params.query,
        { maxResults: params.maxResults, recency: params.recency },
        key,
        signal,
      );

      return {
        content: [{ type: "text", text: formatSearchResponse(resp) }],
        details: resp,
      };
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and return its content as clean, readable text. HTML pages " +
      "are reduced to the main article (Readability); JSON and plain text are " +
      "returned as-is. Works for docs, articles, GitHub, and APIs.",
    promptSnippet: "Fetch a URL and return clean readable text",
    promptGuidelines: [
      "Use web_fetch to read the full content of a page, especially URLs returned by web_search.",
      "For GitHub source files, prefer raw.githubusercontent.com URLs with web_fetch for clean output.",
    ],
    parameters: fetchParameters,
    async execute(_toolCallId, params, signal, onUpdate) {
      onUpdate?.({ content: [{ type: "text", text: `Fetching ${params.url}…` }] });
      const result = await fetchReadable(params.url, params.maxChars, signal);

      const header = [
        result.title ? `# ${result.title}` : null,
        result.byline ? `By ${result.byline}` : null,
        result.siteName ? `Site: ${result.siteName}` : null,
        `URL: ${result.url}`,
        `Extractor: ${result.extractor}${result.truncated ? " (truncated)" : ""}`,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: `${header}\n\n${result.content}` }],
        details: result,
      };
    },
  });

  pi.registerCommand("search-provider", {
    description: "Show or set the web search provider",
    getArgumentCompletions(prefix) {
      const items = [
        { value: "auto", label: "auto (first available)" },
        ...PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
      ];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    async handler(args, ctx) {
      const arg = args.trim();
      if (arg) {
        if (arg !== "auto" && !getProvider(arg)) {
          ctx.ui.notify(
            `Unknown provider "${arg}". Known: auto, ${PROVIDERS.map((p) => p.id).join(", ")}`,
            "error",
          );
          return;
        }
        selected = arg;
        ctx.ui.notify(`Search provider set to: ${arg}`, "info");
        return;
      }

      const available = await listAvailable(ctx);
      const availableIds = available.map((p) => p.id);
      const lines = PROVIDERS.map((p) => {
        const ok = availableIds.includes(p.id) ? "✓" : "✗";
        const mark = p.id === selected ? " (selected)" : "";
        return `  ${ok} ${p.id} — ${p.label}${mark}`;
      });
      ctx.ui.notify(
        `Search provider: ${selected}\n${lines.join("\n")}\n\n` +
          `Set with: /search-provider <id>`,
        "info",
      );
    },
  });
}
