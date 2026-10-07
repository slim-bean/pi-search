import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getProvider, PROVIDERS } from "./registry";
import type { SearchProvider } from "./types";

/** Private to one extension runtime. Never persist these keys or put them in command arguments. */
export function registerSearchLogin(pi: ExtensionAPI, selectProvider: (id: string) => void) {
  const keys = new Map<string, string>();
  pi.on("session_start", () => keys.clear());
  pi.on("session_shutdown", () => keys.clear());

  async function login(ctx: ExtensionContext, provider: SearchProvider): Promise<boolean> {
    if (!ctx.hasUI) {
      ctx.ui.notify("Entering search API keys requires an interactive UI. Use an API-key environment variable instead.", "error");
      return false;
    }
    const value = await ctx.ui.input(`API key for ${provider.label} (session only)`, "Paste API key");
    if (value === undefined) return false;
    const key = value.trim();
    if (!key || /\s/.test(key)) {
      ctx.ui.notify("API key must be non-empty and contain no whitespace. Existing key unchanged.", "error");
      return false;
    }
    keys.set(provider.id, key);
    selectProvider(provider.id);
    ctx.ui.notify(`Session API key set; search provider: ${provider.id}. Cleared on session change, reload or exit.`, "info");
    return true;
  }

  const completions = (prefix: string) => {
    const items = PROVIDERS.filter((p) => p.id.startsWith(prefix)).map((p) => ({ value: p.id, label: p.label }));
    return items.length ? items : null;
  };

  pi.registerCommand("search-login", {
    description: "Enter a session-only API key for any search provider and select it",
    getArgumentCompletions: completions,
    async handler(args, ctx) {
      const id = args.trim();
      if (id && !getProvider(id)) {
        ctx.ui.notify("Usage: /search-login [provider]. Enter the key in the dialog, not in command arguments.", "error");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Entering search API keys requires an interactive UI. Use an API-key environment variable instead.", "error");
        return;
      }
      let provider = getProvider(id);
      if (!provider) {
        const labels = PROVIDERS.map((p) => `${p.id} — ${p.label}${keys.has(p.id) ? " (session key)" : ""}`);
        const picked = await ctx.ui.select("Search provider to log in", labels);
        if (!picked) return;
        provider = PROVIDERS[labels.indexOf(picked)];
      }
      if (provider) await login(ctx, provider);
    },
  });

  pi.registerCommand("search-logout", {
    description: "Clear a session search API key (or all); configured keys remain available",
    getArgumentCompletions(prefix) {
      const items = [{ value: "all", label: "all session keys" }, ...PROVIDERS.map((p) => ({ value: p.id, label: p.label }))];
      const matches = items.filter((p) => p.value.startsWith(prefix));
      return matches.length ? matches : null;
    },
    async handler(args, ctx) {
      const id = args.trim() || "all";
      if (id !== "all" && !getProvider(id)) {
        ctx.ui.notify("Usage: /search-logout [provider|all]", "error");
        return;
      }
      if (id === "all") keys.clear();
      else keys.delete(id);
      ctx.ui.notify(`Cleared session search key: ${id}. Environment/pi credentials are unchanged; provider selection is unchanged.`, "info");
    },
  });

  return { keys, login };
}
