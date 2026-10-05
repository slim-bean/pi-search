# pi-search

Web search and readable web fetch tools for the [pi](https://github.com/earendil-works/pi) coding agent.

Adds three LLM-callable tools (plus `browser_read` when pi-devtools is loaded):

- **`web_search`** — search the web through a pluggable backend. Returns a
  synthesized answer (foundation-model and Tavily providers) plus source URLs.
- **`web_fetch`** — fetch a URL and return it as Markdown. Negotiates
  `text/markdown` with the server, follows `<link rel=alternate
  type=text/markdown>`, otherwise extracts the main article (Mozilla
  Readability) and converts it with Turndown so headings, code blocks and
  links survive. Reports the site's `llms.txt` when one exists. JSON and plain
  text pass through. Optional `screenshot: true` also attaches the first segment
  of a browser-backed visual snapshot.
- **`web_fetch_screenshot`** — retrieve another segment of that frozen snapshot,
  without navigating or refetching the website.

## Providers

Search is pluggable. Two kinds of provider:

| id | kind | key source |
|----|------|-----------|
| `anthropic` | foundation (`web_search_20250305`) | pi-configured Anthropic key, or `ANTHROPIC_API_KEY` |
| `openai` | foundation (Responses `web_search`) | pi-configured OpenAI key, or `OPENAI_API_KEY` |
| `gemini` | foundation (Google Search grounding) | pi-configured Google key, or `GEMINI_API_KEY` / `GOOGLE_API_KEY` |
| `tavily` | dedicated search API | `TAVILY_API_KEY` |
| `brave` | dedicated search API | `BRAVE_API_KEY` |
| `exa` | dedicated search API | `EXA_API_KEY` |

**Foundation** providers reuse the API keys you already have configured in pi
(via `ctx.modelRegistry`), so no extra setup is needed for a provider whose
chat models you already use. **API** providers read a dedicated env var.

Foundation providers require a real **API key**. OAuth (subscription) logins —
e.g. a Claude Pro/Max login stored under the `anthropic` provider — are skipped,
since their tokens are not valid as an `x-api-key` for the search APIs. If your
provider login is OAuth, set the matching env var (`ANTHROPIC_API_KEY`, …) or
point the provider at a pi credential that holds an API key (see below).

### Choosing where a foundation key comes from

By default a foundation provider sources its key from the pi provider of the
same name (`anthropic`, `openai`, `google`). To source it from a different pi
provider that holds an API key (e.g. `anthropic-apikey` when your `anthropic`
login is OAuth), use the `/search-key` command or the
`PI_SEARCH_KEY_PROVIDER_<PROVIDER>` env var.

Precedence: `/search-key` runtime choice → `PI_SEARCH_KEY_PROVIDER_<PROVIDER>` →
default (provider's own credentials) → env-var fallback.

```bash
# Resolve anthropic's search key from the anthropic-apikey provider
PI_SEARCH_KEY_PROVIDER_ANTHROPIC=anthropic-apikey pi
```

```
/search-key                       # show key sources (or pick interactively)
/search-key anthropic-apikey      # set source for the current foundation provider
/search-key anthropic anthropic-apikey  # set source for a named provider
/search-key anthropic default     # back to the provider's own credentials
/search-key openai env            # use OPENAI_API_KEY env var only
```

### Selecting a provider

Precedence: `--search-provider` flag → `/search-provider` command → the
`PI_SEARCH_PROVIDER` env var → `auto`.

In `auto` mode the first provider with an available key wins, tried in the
order listed above (foundation first).

```bash
# Pin a provider for a session
pi --search-provider tavily

# Or via env
PI_SEARCH_PROVIDER=brave pi
```

In a session:

```
/search-provider              # show provider status and current selection
/search-provider tavily       # switch provider
/search-provider auto         # back to auto-detect
```

Override the foundation model used for search with `PI_SEARCH_MODEL`
(e.g. `claude-haiku-4-5`, `gpt-4o-mini`, `gemini-2.0-flash`).

## web_fetch

`web_fetch(url, maxChars?, format?, screenshot?)` is built for agents, not browsers. For text-only retrieval, in order:

1. **Content negotiation.** Sends `Accept: text/markdown;q=1.0, text/html;q=0.8, …`
   (same as Claude Code and OpenCode). Docs sites that publish Markdown for
   agents — grafana.com, Mintlify-hosted docs, Cloudflare, Vercel, and many
   others — return it directly, links and code intact. `Extractor: markdown`.
2. **Alternate link.** If HTML comes back but advertises
   `<link rel="alternate" type="text/markdown">`, that URL is fetched instead
   (one hop). `Extractor: alternate`.
3. **Readability → Turndown.** Otherwise the main article is isolated with
   Mozilla Readability and converted to GitHub-flavoured Markdown.
   `Extractor: readability`.
4. **Body fallback.** When Readability returns too little content (an absolute
   length guard plus a low ratio floor), or loses every code block, the largest `<main>`/`<article>`/`<body>` is
   converted instead, with nav/header/footer stripped. `Extractor: body`.
5. **Naive strip** as a last resort. `Extractor: naive`.

JSON, plain text and other non-HTML types pass through unchanged
(`Extractor: raw`). Redirects are followed and the final URL is reported.

Unless browser-only retrieval is used (including explicit screenshots), results
also probe `<origin>/llms.txt` once per origin (3 s timeout, cached) and, when found,
add an `llms.txt: <url>` line so the model can
discover the site's curated docs index.

| `format` | Behaviour |
|---|---|
| `markdown` (default) | Steps 1–5 above. |
| `text` | Prefers `text/plain`; HTML is reduced to plain text (no Turndown). Server Markdown is still accepted. |
| `html` | Returns the raw HTML. `Accept` omits `text/markdown` entirely because some servers ignore q-values. |

Why this matters: on `grafana.com/docs/loki/latest/query/` the old
`textContent` extraction yielded 0 headings, 0 links and 0 code fences. Native
Markdown gives 8 / 24 / 10; Turndown on the same HTML gives 7 / 18 / 10.

### Blocked sites

Some sites refuse non-browser clients at the TLS-fingerprint level, so no
User-Agent or header tweak gets through. Two shapes are recognised:

- HTTP 401/403/429/503 from a WAF.
- HTTP **200** whose body is a JavaScript challenge or a captcha interstitial,
  not the page. The old behaviour handed the model that shell as if it were
  content, which is worse than an error because it looks real.

Both become a `BlockedError` naming the protection and suggesting alternatives,
instead of a bogus success.

Escalation, in order of what usually works: a search provider that already has
the content indexed; a hosted reader proxy; a self-hosted browser proxy; and for
sites that gate content behind an account, a signed-in browser profile. Some
hosts refuse hosted readers as firmly as they refuse a plain HTTP client —
list those in `PI_SEARCH_PROXY_SKIP_HOSTS` so pi-search doesn't disclose the URL
to a third party for nothing.

Search providers differ here too: their coverage depends on their licensing
deals, so a site missing from one provider's results may be present in
another's. Switch with `/search-provider`.

### Reader proxies (opt-in, off by default)

When a fetch is blocked, `web_fetch` can retry through a proxy that renders the
page in a real browser. Two are built in:

```bash
PI_SEARCH_FETCH_PROXY=jina        # hosted reader, r.jina.ai
PI_SEARCH_FETCH_PROXY=browser     # your own Chrome, via a browser-fetch server
PI_SEARCH_FETCH_PROXY=off         # default

# Skip the doomed direct attempt for hosts you know always block:
PI_SEARCH_FETCH_PROXY_HOSTS=host.example,another.example
# Hosts where hosted readers are refused too (a self-hosted browser is still tried):
PI_SEARCH_PROXY_SKIP_HOSTS=host.example
```

Only blocked fetches use a proxy. The result header shows which one and how the
page was reduced, e.g. `Extractor: proxy (browser 127.0.0.1:8377 → readability)`.

**`jina`** — [Jina AI Reader](https://jina.ai/reader/) fetches with headless
Chrome or `curl-impersonate` and returns Markdown. Free without a key at 20
req/min; Apache-2.0 and self-hostable
([jina-ai/reader](https://github.com/jina-ai/reader)). Optional `JINA_API_KEY`
raises limits. We send `DNT: 1` so Jina does not cache or log the request, but
the URL is still disclosed to a third party — hence opt-in, and why
`PI_SEARCH_PROXY_SKIP_HOSTS` exists for hosts that refuse hosted readers anyway.

**`browser`** — [browser-fetch](https://github.com/slim-bean/browser-fetch): a
separate Go service that drives a real, user-launched Chrome over CDP and
returns rendered HTML, which then goes through the normal Readability →
Turndown pipeline. Nothing leaves your network. It is the most capable option: because
the profile persists and the window is visible, a human can sign in or clear an
interactive challenge once, and later fetches reuse those cookies (measured:
~1-2 s per page afterwards).

```bash
PI_SEARCH_FETCH_PROXY=browser
PI_SEARCH_BROWSER_URL=http://127.0.0.1:8377   # or your VM's private IP
PI_SEARCH_BROWSER_TOKEN=…                     # matches the gateway's -token
PI_SEARCH_BROWSER_TOKEN_FILE=/run/secrets/browser-fetch/token  # optional; takes precedence
PI_SEARCH_BROWSER_TIMEOUT_MS=60000            # optional
PI_SEARCH_BROWSER_ASSIST_MS=90000             # optional: hold challenges for a human
```

### Browser-only page retrieval

```bash
PI_SEARCH_FETCH_MODE=browser-only
PI_SEARCH_BROWSER_URL=http://127.0.0.1:19377
PI_SEARCH_BROWSER_TOKEN=…
```

`PI_SEARCH_FETCH_MODE` is `auto` (existing behavior, default) or `browser-only`.
Browser-only always selects the browser gateway, regardless of the fallback proxy
or host lists. It **never** directly fetches the target, an alternate Markdown URL,
or `llms.txt`, and never falls back if the gateway is missing or fails. It returns
rendered page content, not the wire response: even `format: html` is rendered DOM,
and native JSON/plain-text pages are processed from their browser representation.
This setting only governs `web_fetch`, not search-provider API calls or other tools.
The same gateway URL works for remote/container browsers; token files are read per
request and gateway redirects are refused. Lifecycle and CDP connections remain the
responsibility of pi-devtools/pi-assistant, not this extraction tool.

The extension advertises `{browserOnly: true, screenshots: true}` on `pi-search:capabilities:v1`
(by synchronously assigning the request's `result`) so coordinators can reject
older versions instead of silently getting direct HTTP behavior.

The module API also accepts `fetchReadable(url, {mode: "browser-only"})`; explicit
options override the environment. Browser lifecycle remains external: run a gateway
and Chrome yourself, or use pi-assistant for lazy managed startup.

### Paginated visual snapshots

```ts
web_fetch({ url: "https://example.com/listing", screenshot: true })
// Returns extracted text + the first image, with a capture ID and segment count.
web_fetch_screenshot({ captureId: "<returned capture ID>", segment: 2 })
```

Screenshots **always use browser-fetch**, regardless of `PI_SEARCH_FETCH_MODE`,
proxy selection or host lists. Configure `PI_SEARCH_BROWSER_URL` and its gateway
credential as above; root, driver and reader credentials can all create captures.
No direct target/alternate/llms.txt requests occur, and missing/old gateways fail
explicitly instead of silently returning text only. No pi-devtools dependency is
needed. Ordinary calls without `screenshot: true` are unchanged.

The gateway captures one bounded full-page bitmap at a 1280 × 900 CSS-pixel viewport
and device scale 1, then crops it into vertical segments **before** any downsizing:

- At most **1280 × 1400 pixels / 384 KiB JPEG** per returned image.
- **100 CSS-pixel overlap**, one-based segment numbers, at most 10 segments.
- Captures stop at **12,000 CSS pixels**; height/horizontal clipping is reported.
- Immutable segments expire after **10 minutes** or gateway restart. Retrieve them
  using the **same credential class** that created the capture; root cannot read a
  reader capture by ID. Expiration never triggers automatic navigation/recapture.
- Storage is memory-only and bounded (32 captures / 64 MiB); a full store returns
  an explicit error. The gateway must have `-block-media=false` (the default).

The tool returns real image attachments for a **vision-capable model**, not base64
in prose. Exact context cost depends on the model; only the requested segment is
attached. The extension itself needs no model credential to fetch/capture pages
(the gateway credential is separate). A local worker model must support image
inputs and be configured as such in pi to interpret the screenshots.

This is a frozen visual snapshot, not site pagination: the gateway briefly waits
for visible images but does not scroll, load every lazy image, click galleries or
capture nested scrolling regions. For Marketplace gallery slides or an already-open
page, use pi-devtools' interactive tools and `browser_screenshot` instead.

### Read the current live tab

When pi-devtools is also loaded, pi-search registers **`browser_read(maxChars?)`**.
It obtains the selected tab's `{html,url,title}` through the versioned
`pi-devtools:snapshot:v1` event channel and uses the same HTML extraction as
`web_fetch`, without any network fetch, navigation, or llms.txt probe. This preserves
current interactive state. For email/app controls or content article extraction
omits, use `browser_dom`. The extractor is also exported as `extractFromHtml` from
`src/fetch/fetch.ts` for local integrations.

## Install

This is a pi package. Add it to your pi `settings.json`:

```json
{
  "extensions": ["/path/to/pi-search/src/index.ts"]
}
```

Or symlink/copy into an auto-discovered location
(`~/.pi/agent/extensions/` or a project's `.pi/extensions/`).

Run `npm install` in this directory first so `jsdom`, `@mozilla/readability`,
`turndown` and `turndown-plugin-gfm` are available to `web_fetch`.

For quick testing without installing:

```bash
pi -e ./src/index.ts
```

## Development

```
src/
  index.ts              # registers search/fetch/screenshot tools, commands, --search-provider flag
  search/
    types.ts            # SearchProvider interface, SearchResult/SearchResponse
    registry.ts         # provider list, auto-detect, selection
    keys.ts             # API-key resolution (pi registry + env; skips OAuth creds)
    keySource.ts        # foundation key-source overrides (/search-key, env)
    format.ts           # SearchResponse -> text for the LLM
    providers/          # one file per backend (anthropic, openai, gemini, tavily, brave, exa)
  fetch/
    fetch.ts            # web fetch: content negotiation, alternate link, Readability + Turndown, body fallback, llms.txt probe
    blocked.ts          # bot-protection detection + the LLM-facing explanation
    screenshot.ts       # screenshot protocol validation + model-facing presentation
    screenshot-tool.ts  # frozen capture continuation tool
    proxies/            # reader proxies: types.ts, jina.ts, browser.ts, index.ts (selection + host routing)
```

### Tests

```bash
npm test                       # mocked tests, including tool registration; installed pi peers, no auth reads
npm run typecheck              # resolves peer types against installed pi
npm run test:live:screenshot    # builds ../browser-fetch; isolated headless Chrome + synthetic pages
```

The screenshot live test launches a temporary profile and gateway, exercises the
registered tools and the gateway's live screenshot test, then cleans up. No model
calls, pi sessions or user auth files are involved. Set `CHROME_PATH` for a nonstandard
Chrome installation, `PI_ROOT` for a nonstandard pi install, and optionally
`SCREENSHOT_TEST_OUTPUT_DIR=/tmp/visual-test` to retain synthetic JPEGs/manifests.

The shared-browser live test is in `../pi-assistant/test/live.ts`; it uses an isolated
profile and synthetic pages (no model calls or personal accounts).

### Adding a provider

Implement the `SearchProvider` interface in `src/search/providers/` and add it
to the `PROVIDERS` array in `src/search/registry.ts`. Foundation providers
should resolve their key via `foundationKey(ctx, ...)`; API providers via
`envKey(...)`.
