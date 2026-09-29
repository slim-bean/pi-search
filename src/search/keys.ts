import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeySource, isOAuthCredential, KEY_SOURCE_ENV } from "./keySource";

/** Read the first non-empty environment variable from a list. */
export function envKey(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Resolve a foundation-provider key from pi's credentials, falling back to
 * explicit env vars.
 *
 * OAuth (subscription) credentials are skipped: their access tokens are not
 * valid as an `x-api-key` for the search APIs, so we never forward them. Use
 * the key source override (`/search-key` or PI_SEARCH_KEY_PROVIDER_<PROVIDER>)
 * to point at a provider that holds a real API key (e.g. `anthropic-apikey`).
 */
export async function foundationKey(
  ctx: ExtensionContext,
  piProvider: string,
  ...envFallback: string[]
): Promise<string | undefined> {
  const source = getKeySource(piProvider);

  // Explicit "env" source: skip stored credentials entirely.
  if (source !== KEY_SOURCE_ENV) {
    const sourceId = source ?? piProvider;
    if (!isOAuthCredential(ctx, sourceId)) {
      try {
        const key = await ctx.modelRegistry.getApiKeyForProvider(sourceId);
        if (key) return key;
      } catch {
        // ignore registry errors, fall back to env
      }
    }
  }

  return envKey(...envFallback);
}
