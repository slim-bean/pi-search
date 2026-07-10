import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

import { resolveProvider, listAvailable, getProvider, PROVIDERS } from "./search/registry";
import { formatSearchResponse } from "./search/format";
import { fetchReadable } from "./fetch/fetch";
import type { SearchProvider } from "./search/types";
import {
  setKeySource,
  getKeySource,
  listApiKeyProviders,
  KEY_SOURCE_DEFAULT,
  KEY_SOURCE_ENV,
} from "./search/keySource";

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

  const foundations = () => PROVIDERS.filter((p) => p.kind === "foundation");

  const describeSource = (source: string | undefined, piProvider: string): string => {
    if (!source || source === KEY_SOURCE_DEFAULT) return `default (${piProvider})`;
    if (source === KEY_SOURCE_ENV) return "environment variable only";
    return `pi provider "${source}"`;
  };

  const applyKeySource = (
    ctx: ExtensionContext,
    target: SearchProvider,
    source: string,
  ): void => {
    const piProvider = target.piProvider!;
    setKeySource(piProvider, source === KEY_SOURCE_DEFAULT ? undefined : source);
    ctx.ui.notify(
      `Search key for ${target.id} sourced from: ${describeSource(source, piProvider)}`,
      "info",
    );
  };

  pi.registerCommand("search-key", {
    description: "Show or set which pi provider supplies a foundation provider's search API key",
    getArgumentCompletions(prefix) {
      const items = [
        ...foundations().map((p) => ({ value: p.id, label: `${p.id} (foundation provider)` })),
        { value: KEY_SOURCE_DEFAULT, label: "default (use provider's own credentials)" },
        { value: KEY_SOURCE_ENV, label: "env (environment variable only)" },
      ];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const current = getProvider(selected);
      const currentFoundation = current?.kind === "foundation" ? current : undefined;

      // Resolve target foundation provider and (optionally) the source from args.
      let target: SearchProvider | undefined;
      let source: string | undefined;
      if (parts.length >= 2) {
        target = getProvider(parts[0]);
        source = parts[1];
      } else if (parts.length === 1) {
        const asProvider = getProvider(parts[0]);
        if (asProvider?.kind === "foundation") {
          target = asProvider;
        } else {
          target = currentFoundation;
          source = parts[0];
        }
      }

      // Direct, non-interactive set.
      if (source) {
        if (!target || target.kind !== "foundation" || !target.piProvider) {
          ctx.ui.notify(
            `Key source applies to foundation providers only: ${foundations()
              .map((p) => p.id)
              .join(", ")}. ` + `Usage: /search-key [<provider>] <source>`,
            "error",
          );
          return;
        }
        applyKeySource(ctx, target, source);
        return;
      }

      // No source given: without UI, show current key sources.
      if (!ctx.hasUI) {
        const lines = foundations().map((p) => {
          const eff = getKeySource(p.piProvider!);
          return `  ${p.id} — ${describeSource(eff, p.piProvider!)}`;
        });
        ctx.ui.notify(
          `Search key sources:\n${lines.join("\n")}\n\n` +
            `Set with: /search-key [<provider>] <source>`,
          "info",
        );
        return;
      }

      // Interactive: pick the target foundation provider if not already known.
      if (!target) {
        const fps = foundations();
        const labels = fps.map((p) => {
          const eff = getKeySource(p.piProvider!);
          return `${p.id} — ${describeSource(eff, p.piProvider!)}`;
        });
        const picked = await ctx.ui.select("Foundation search provider", labels);
        if (!picked) return;
        target = fps[labels.indexOf(picked)];
      }
      if (!target?.piProvider) return;

      // Interactive: pick the key source.
      const apiKeyProviders = listApiKeyProviders(ctx);
      const values = [KEY_SOURCE_DEFAULT, ...apiKeyProviders, KEY_SOURCE_ENV];
      const labels = values.map((v) => describeSource(v, target!.piProvider!));
      const picked = await ctx.ui.select(`Key source for ${target.id}`, labels);
      if (!picked) return;
      applyKeySource(ctx, target, values[labels.indexOf(picked)]);
    },
  });
}
