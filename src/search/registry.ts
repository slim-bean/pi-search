import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SearchProvider } from "./types";
import { anthropicProvider } from "./providers/anthropic";
import { openaiProvider } from "./providers/openai";
import { geminiProvider } from "./providers/gemini";
import { tavilyProvider } from "./providers/tavily";
import { braveProvider } from "./providers/brave";
import { exaProvider } from "./providers/exa";

/**
 * All known providers, in auto-detect priority order. Foundation-model
 * providers come first because users typically already have those keys
 * configured in pi; dedicated search APIs follow.
 */
export const PROVIDERS: SearchProvider[] = [
  anthropicProvider,
  openaiProvider,
  geminiProvider,
  tavilyProvider,
  braveProvider,
  exaProvider,
];

export function getProvider(id: string): SearchProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export interface ResolvedProvider {
  provider: SearchProvider;
  key: string;
}

/**
 * Resolve which provider to use and its API key.
 *
 * If `preferredId` is set, only that provider is tried (error if its key is
 * missing). Otherwise, providers are tried in priority order and the first
 * one with an available key wins.
 */
export async function resolveProvider(
  ctx: ExtensionContext,
  preferredId: string | undefined,
  sessionKeys: ReadonlyMap<string, string> = new Map(),
): Promise<ResolvedProvider> {
  if (preferredId && preferredId !== "auto") {
    const provider = getProvider(preferredId);
    if (!provider) {
      throw new Error(
        `Unknown search provider "${preferredId}". Known: ${PROVIDERS.map((p) => p.id).join(", ")}`,
      );
    }
    const key = sessionKeys.get(provider.id) ?? await provider.resolveKey(ctx);
    if (!key) {
      throw new Error(`No API key available for search provider "${preferredId}". Use /search-login ${preferredId} or configure its API-key environment variable.`);
    }
    return { provider, key };
  }

  for (const provider of PROVIDERS) {
    const key = sessionKeys.get(provider.id) ?? await provider.resolveKey(ctx);
    if (key) return { provider, key };
  }

  throw new Error(
    "No web search provider available. Configure a key for one of: " +
      PROVIDERS.map((p) => p.id).join(", ") +
      ". Use /search-login to enter a session key. Foundation providers reuse your pi API keys; Tavily/Brave/Exa use " +
      "TAVILY_API_KEY / BRAVE_API_KEY / EXA_API_KEY.",
  );
}

/** Find the available providers (those with a resolvable key). */
export async function listAvailable(
  ctx: ExtensionContext,
  sessionKeys: ReadonlyMap<string, string> = new Map(),
): Promise<SearchProvider[]> {
  const available: SearchProvider[] = [];
  for (const provider of PROVIDERS) {
    if (sessionKeys.get(provider.id) || await provider.resolveKey(ctx)) available.push(provider);
  }
  return available;
}
