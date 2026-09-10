# AGENTS.md

pi-search is a pi extension providing two LLM tools: `web_search` (pluggable
backend) and `web_fetch` (URL → Markdown for agents). See `README.md` for user
docs.

## Layout

- `src/index.ts` — entry point. Registers both tools, the `/search-provider`
  and `/search-key` commands, and the `--search-provider` flag. Holds the
  runtime `selected` provider id (flag → command → `PI_SEARCH_PROVIDER` env →
  `auto`).
- `src/search/types.ts` — `SearchProvider` interface plus `SearchResult` /
  `SearchResponse` / `SearchOptions` and the `recencyToDays` helper.
- `src/search/registry.ts` — `PROVIDERS` (priority-ordered), `resolveProvider`
  (selection + key resolution), `listAvailable`.
- `src/search/keys.ts` — `foundationKey` (pi `modelRegistry` then env) and
  `envKey`. `foundationKey` skips OAuth-typed credentials (their tokens aren't
  valid `x-api-key`s) and honors the key-source override.
- `src/search/keySource.ts` — per-foundation-provider key-source overrides:
  `getKeySource`/`setKeySource` (runtime `/search-key` →
  `PI_SEARCH_KEY_PROVIDER_<PROVIDER>` env), `listApiKeyProviders`, and the
  `default`/`env` sentinels.
- `src/search/format.ts` — renders a `SearchResponse` to text for the LLM.
- `src/search/providers/*.ts` — one provider per file.
- `src/fetch/fetch.ts` — `fetchReadable(url, { maxChars, format, signal })`.
  Pipeline: `Accept: text/markdown` negotiation → `<link rel=alternate
  type=text/markdown>` → Readability + Turndown (GFM) → body fallback → naive
  strip. Also `probeLlmsTxt(origin)` (cached per origin). The `Extractor`
  union documents which path produced the content. Originally ported from
  2h-team/wiki `fetchTools.ts`.

## Conventions

- Foundation providers (`anthropic`, `openai`, `gemini`) resolve keys via
  `foundationKey(ctx, piProviderName, ...envFallback)` so they reuse the user's
  existing pi credentials, and declare `piProvider` (the pi provider id backing
  them) so `/search-key` can target them. API providers (`tavily`, `brave`,
  `exa`) use `envKey(...)` only.
- OAuth (subscription) logins are never forwarded as API keys. Users with an
  OAuth-backed provider point at an API-key credential via `/search-key` or
  `PI_SEARCH_KEY_PROVIDER_<PROVIDER>`.
- To add a provider: implement `SearchProvider`, export it, append to
  `PROVIDERS` in `registry.ts` (order = auto-detect priority).
- Throw from `provider.search` / `fetchReadable` on error; pi marks the tool
  result as an error and reports it to the LLM.
- Pass `signal` through to `fetch` so Esc can cancel.
- `fetch.ts` Accept headers: keep `text/markdown` **out** of the `html` format
  and out of the `llms.txt` probe. grafana.com (and likely others) ignore
  q-values and serve Markdown whenever the type appears, and 404 `/llms.txt`
  when asked for Markdown. Both were observed in production.
- Readability mutates the DOM; parse a clone so the body fallback sees the
  original document.
- Never let the `llms.txt` probe throw or block: it is best-effort, cached,
  and bounded by `LLMS_TXT_TIMEOUT_MS`.

## Testing

End-to-end (requires a configured provider key):

```bash
pi -e ./src/index.ts -p "Use web_search to find X. Then stop."
pi -e ./src/index.ts -p "Use web_fetch on https://example.com. Then stop."
```

`npm install` must have been run so `jsdom`, `@mozilla/readability`, `turndown`
and `turndown-plugin-gfm` resolve.

Direct module test without spending LLM tokens (Node ≥ 22.6 strips types):

```bash
node -e 'import("./src/fetch/fetch.ts").then(async m => { const r = await m.fetchReadable("https://grafana.com/docs/loki/latest/query/"); console.log(r.extractor, r.llmsTxt, r.length); })'
```

Useful fixtures: `grafana.com/docs/*` (negotiates Markdown), `grafana.com/oss/loki/`
(body fallback), any `text/html` page that sets `<link rel=alternate
type=text/markdown>` without negotiating (alternate path). Type-check with
`npx -y -p typescript@5 tsc --noEmit -p tsconfig.json`; errors about
`@earendil-works/*` / `typebox` are expected (pi-provided peers).
