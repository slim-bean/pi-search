import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Read the first non-empty environment variable from a list. */
export function envKey(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Resolve a foundation-provider key from pi's model registry (env vars,
 * models.json, runtime keys), falling back to explicit env vars.
 */
export async function foundationKey(
  ctx: ExtensionContext,
  piProvider: string,
  ...envFallback: string[]
): Promise<string | undefined> {
  try {
    const key = await ctx.modelRegistry.getApiKeyForProvider(piProvider);
    if (key) return key;
  } catch {
    // ignore registry errors, fall back to env
  }
  return envKey(...envFallback);
}
