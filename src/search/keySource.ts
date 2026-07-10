import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Where a foundation search provider should source its API key from. A "source"
 * is a pi provider id whose stored api-key credential we reuse (e.g. resolve
 * anthropic's search key from the `anthropic-apikey` provider instead of the
 * OAuth-backed `anthropic` provider).
 *
 * Two sentinel values:
 *  - "default": use the provider's own id (normal behaviour).
 *  - "env":     ignore stored credentials, use env-var fallback only.
 */
export const KEY_SOURCE_DEFAULT = "default";
export const KEY_SOURCE_ENV = "env";

/** Runtime overrides set via /search-key: pi provider name -> source id. */
const runtimeOverrides = new Map<string, string>();

/** Set (or clear, when "default") the runtime key source for a pi provider. */
export function setKeySource(piProvider: string, sourceId: string | undefined): void {
  if (!sourceId || sourceId === KEY_SOURCE_DEFAULT) {
    runtimeOverrides.delete(piProvider);
  } else {
    runtimeOverrides.set(piProvider, sourceId);
  }
}

/**
 * Resolve the effective key source for a pi provider, or undefined when using
 * the default. Precedence: runtime (/search-key) > env
 * PI_SEARCH_KEY_PROVIDER_<PROVIDER> > default.
 */
export function getKeySource(piProvider: string): string | undefined {
  const runtime = runtimeOverrides.get(piProvider);
  if (runtime) return runtime;
  const envName = `PI_SEARCH_KEY_PROVIDER_${piProvider.toUpperCase()}`;
  const value = process.env[envName];
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** List pi provider ids that have a stored api-key credential. */
export function listApiKeyProviders(ctx: ExtensionContext): string[] {
  try {
    return ctx.modelRegistry.authStorage
      .list()
      .filter((id) => ctx.modelRegistry.authStorage.get(id)?.type === "api_key");
  } catch {
    return [];
  }
}
