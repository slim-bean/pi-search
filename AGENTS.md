# AGENTS.md

pi-search is a pi extension providing two LLM tools: `web_search` (pluggable
backend) and `web_fetch` (readable URL fetch). See `README.md` for user docs.

## Layout

- `src/index.ts` — entry point. Registers both tools, the `/search-provider`
  command, and the `--search-provider` flag. Holds the runtime `selected`
  provider id (flag → command → `PI_SEARCH_PROVIDER` env → `auto`).
- `src/search/types.ts` — `SearchProvider` interface plus `SearchResult` /
  `SearchResponse` / `SearchOptions` and the `recencyToDays` helper.
- `src/search/registry.ts` — `PROVIDERS` (priority-ordered), `resolveProvider`
  (selection + key resolution), `listAvailable`.
- `src/search/keys.ts` — `foundationKey` (pi `modelRegistry` then env) and
  `envKey`.
- `src/search/format.ts` — renders a `SearchResponse` to text for the LLM.
- `src/search/providers/*.ts` — one provider per file.
- `src/fetch/fetch.ts` — `fetchReadable`, ported from 2h-team/wiki
  `fetchTools.ts`, adapted to Node (jsdom instead of browser DOMParser, direct
  fetch instead of CORS proxy).

## Conventions

- Foundation providers (`anthropic`, `openai`, `gemini`) resolve keys via
  `foundationKey(ctx, piProviderName, ...envFallback)` so they reuse the user's
  existing pi credentials. API providers (`tavily`, `brave`, `exa`) use
  `envKey(...)` only.
- To add a provider: implement `SearchProvider`, export it, append to
  `PROVIDERS` in `registry.ts` (order = auto-detect priority).
- Throw from `provider.search` / `fetchReadable` on error; pi marks the tool
  result as an error and reports it to the LLM.
- Pass `signal` through to `fetch` so Esc can cancel.

## Testing

End-to-end (requires a configured provider key):

```bash
pi -e ./src/index.ts -p "Use web_search to find X. Then stop."
pi -e ./src/index.ts -p "Use web_fetch on https://example.com. Then stop."
```

`npm install` must have been run so `jsdom` / `@mozilla/readability` resolve.
