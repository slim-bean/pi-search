# AGENTS.md

pi-search provides `web_search` (pluggable backend), `web_fetch` (URL → text,
optional paginated screenshot), and `web_fetch_screenshot` (frozen capture segment).
`browser_read` is conditional on pi-devtools. See `README.md` for user docs.

## Layout

- `src/index.ts` — entry point. Registers search/fetch tools plus the screenshot
  continuation helper, `/search-provider`, `/search-key`, `/search-login`,
  `/search-logout`, and `--search-provider`. Holds the
  runtime `selected` provider id (flag → command → `PI_SEARCH_PROVIDER` env →
  `auto`).
- `src/search/types.ts` — `SearchProvider` interface plus `SearchResult` /
  `SearchResponse` / `SearchOptions` and the `recencyToDays` helper.
- `src/search/registry.ts` — `PROVIDERS` (priority-ordered), `resolveProvider`
  (selection + key resolution), `listAvailable`. Both accept a runtime-private
  session-key map which overrides configured keys.
- `src/search/login.ts` — interactive API-key entry for all providers, including
  unconfigured ones. Login selects the provider; logout removes only session keys.
  Never persist/echo keys, mutate env, or accept keys in slash-command arguments.
  Clear keys on session_start/session_shutdown; reload creates a fresh map.
  `/search-provider` shows all providers and offers login for unavailable ones.
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
- `src/fetch/browser-read.ts` — conditional `browser_read` tool (when pi-devtools
  is present); reads its live snapshot via `pi-devtools:snapshot:v1`, then invokes
  the exported pure `extractFromHtml`. No refetch/probe and sequential execution.
- `src/fetch/screenshot.ts` — browser-fetch screenshot protocol v1 validation,
  attachment/presentation helpers (never duplicate base64 in tool details).
  `screenshot-tool.ts` registers the continuation tool. `proxies/browser.ts` shares
  authenticated, redirect-refusing transport for captures/continuations.
- `src/fetch/blocked.ts` — bot-protection detection: `classifyBlockedResponse`
  (401/403/429/503 + vendor from headers), `detectChallengePage` (200 bodies
  that are JS-challenge, captcha or WAF interstitials),
  `BlockedError`, and `blockedMessage` (the LLM-facing explanation).
- `src/fetch/proxies/` — opt-in reader proxies (`PI_SEARCH_FETCH_PROXY`).
  `types.ts` (`ReaderProxy`, `ProxyResult`, `ProxyTargetBlockedError`),
  `jina.ts` (hosted, returns Markdown), `browser.ts` (talks to
  a browser-fetch server, returns HTML), `index.ts` (`PROXIES`, `selectedProxy`,
  `isProxyHost` for `PI_SEARCH_FETCH_PROXY_HOSTS`). A proxy returns either
  `content` (Markdown, used as-is) or `html` (run through the normal
  Readability → Turndown pipeline so output shape matches a direct fetch).
- The `browser` proxy talks to [browser-fetch](https://github.com/slim-bean/browser-fetch),
  a separate repo (Go service driving a real Chrome over CDP). The wire
  contract is `POST /fetch {url,timeout_ms,assist_ms}` →
  `{url,title,html,status,…}`. Optional `screenshot: true` adds the first visual
  segment; `POST /fetch/screenshot {capture_id,segment}` retrieves another without
  navigation. The gateway owns image processing, temporary storage and expiration.
  Error `code`s `challenge` / `nav_error` /
  `rejected_url` meaning "the target refused" (mapped to
  `ProxyTargetBlockedError`) and anything else meaning "the proxy is broken".

## Conventions

- Foundation providers (`anthropic`, `openai`, `gemini`) resolve keys via
  `foundationKey(ctx, piProviderName, ...envFallback)` so they reuse the user's
  existing pi credentials, and declare `piProvider` (the pi provider id backing
  them) so `/search-key` can target them. API providers (`tavily`, `brave`,
  `exa`) use `envKey(...)` as their configured fallback. Session keys override
  either path in the registry, without changing pi model credentials.
- Credential inspection supports legacy authStorage and current ModelRegistry
  methods. If credential type cannot be established, fall back to explicit env keys
  rather than forwarding an unknown token. Current `/search-key` candidates are
  configured non-OAuth model providers (legacy pi lists stored API-key providers).
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
- `PI_SEARCH_FETCH_MODE=browser-only` (or `FetchOptions.mode`) is fail-closed:
  force browserProxy regardless of host/fallback configuration, and make no target,
  alternate-link, or llms.txt direct requests. Errors must not suggest silent direct
  fallback. Standalone `auto` remains the default.
- `FetchOptions.screenshot: true` always forces browser-only behavior (even in
  auto mode). No direct requests or text-only fallback on old gateways. Validate
  screenshot version, dimensions, bytes and SHA-256 before attaching. Continuation
  errors must never trigger recapture. Real image content requires a vision model;
  don't add model calls or credential resolution to visual retrieval.
- Never let the `llms.txt` probe throw or block: it is best-effort, cached,
  and bounded by `LLMS_TXT_TIMEOUT_MS`.
- Don't try to defeat bot protection with browser User-Agents or spoofed
  `Sec-Fetch-*` headers. The blocks we tested against are TLS-fingerprint based
  and a Chrome UA from curl gets the same 403; an
  honest UA plus a clear error is the right behaviour. Reader proxies are the
  sanctioned escape hatch and stay opt-in (URL disclosure).
- Some hosts refuse *hosted* proxies too. `fetchViaProxy` short-circuits on
  `skipsHostedProxies` (from `PI_SEARCH_PROXY_SKIP_HOSTS`) for everything except
  the `browser` proxy, which is self-hosted and often does get through — no
  wasted call, no needless URL disclosure. Keep this configuration, not
  hardcoded host knowledge.
- To add a proxy: implement `ReaderProxy` in `src/fetch/proxies/`, append to
  `PROXIES` in `index.ts`. Throw `ProxyTargetBlockedError` when the *target*
  refused the proxy, plain `Error` when the proxy itself failed; the two produce
  different advice to the model. Browser gateway authentication supports
  `PI_SEARCH_BROWSER_TOKEN_FILE` (takes precedence over the token env var, reread
  per request). Refuse gateway redirects; never send the token to a redirect target.
- Extraction thresholds in `fetch.ts` are tuned against real pages, not
  intuition: Readability legitimately returns 5–12% of body text on comment-heavy
  pages (measured 4.6% on a discussion thread, 12.5% on a long-form article),
  so the guard is absolute length
  (`READABILITY_MIN_CHARS`) with a low ratio floor, plus a `losesCode` check — if
  the body has `<pre>` and Readability kept none, prefer the body candidate.
- Keep `@mozilla/readability` current. 0.5.0 silently dropped tab-widget code
  blocks (grafana.com tutorials lost their `docker compose up -d`); 0.6.0 keeps
  them. Re-run the fixture checks in Testing below after upgrading.

## Testing

`npm test` runs mocked transport/extraction/credential/tool-registration tests;
`npm run typecheck` resolves peers against installed pi. `npm run test:live:screenshot`
builds ../browser-fetch and uses isolated headless Chrome/synthetic pages, exercising
registered tools without pi sessions, model calls or user auth/profile access.
Optional `SCREENSHOT_TEST_OUTPUT_DIR` retains fixtures; `CHROME_PATH` overrides Chrome. Shared-browser live tests are in
`../pi-assistant/test/live.ts` (synthetic pages, temporary profile, no model calls).

End-to-end (requires a configured provider key):

```bash
pi -e ./src/index.ts -p "Use web_search to find X. Then stop."
pi -e ./src/index.ts -p "Use web_fetch on https://example.com. Then stop."
```

`npm install` must have been run so `jsdom`, `@mozilla/readability`, `turndown`
and `turndown-plugin-gfm` resolve.

Direct module test without spending LLM tokens. Relative imports are
extensionless (pi resolves them via jiti), so use `tsx` rather than Node's
native type stripping:

```bash
npx -y tsx -e 'import("./src/fetch/fetch.ts").then(async m => { const r = await m.fetchReadable("https://grafana.com/docs/loki/latest/query/"); console.log(r.extractor, r.llmsTxt, r.length); })'
```

Useful fixtures: `grafana.com/docs/*` (negotiates Markdown), `grafana.com/oss/loki/`
(body fallback), any `text/html` page that sets `<link rel=alternate
type=text/markdown>` without negotiating (alternate path),
a discussion site that serves a 200 JS-challenge or captcha shell to
non-browser clients (→ `BlockedError`), a publisher behind a WAF that 403s them
(succeeds with `PI_SEARCH_FETCH_PROXY=jina` or `=browser`),
`grafana.com/tutorials/play-with-grafana-mimir/` (must contain
`docker compose up -d` — the tab-widget code-block regression). Type-check with
`npm run typecheck` (or set `PI_ROOT` to a different installed pi).
