# pi-search

Web search and readable web fetch tools for the [pi](https://github.com/earendil-works/pi) coding agent.

Adds two LLM-callable tools:

- **`web_search`** — search the web through a pluggable backend. Returns a
  synthesized answer (foundation-model and Tavily providers) plus source URLs.
- **`web_fetch`** — fetch a URL and return it as Markdown. Negotiates
  `text/markdown` with the server, follows `<link rel=alternate
  type=text/markdown>`, otherwise extracts the main article (Mozilla
  Readability) and converts it with Turndown so headings, code blocks and
  links survive. Reports the site's `llms.txt` when one exists. JSON and plain
  text pass through.

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

`web_fetch(url, maxChars?, format?)` is built for agents, not browsers. In order:

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
4. **Body fallback.** When Readability keeps under 20% of the page text
   (marketing pages, card grids), the largest `<main>`/`<article>`/`<body>` is
   converted instead, with nav/header/footer stripped. `Extractor: body`.
5. **Naive strip** as a last resort. `Extractor: naive`.

JSON, plain text and other non-HTML types pass through unchanged
(`Extractor: raw`). Redirects are followed and the final URL is reported.

Every result also probes `<origin>/llms.txt` once per origin (3 s timeout,
cached) and, when found, adds an `llms.txt: <url>` line so the model can
discover the site's curated docs index.

| `format` | Behaviour |
|---|---|
| `markdown` (default) | Steps 1–5 above. |
| `text` | Prefers `text/plain`; HTML is reduced to plain text (no Turndown). Server Markdown is still accepted. |
| `html` | Returns the raw HTML. `Accept` omits `text/markdown` entirely because some servers ignore q-values. |

Why this matters: on `grafana.com/docs/loki/latest/query/` the old
`textContent` extraction yielded 0 headings, 0 links and 0 code fences. Native
Markdown gives 8 / 24 / 10; Turndown on the same HTML gives 7 / 18 / 10.

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
  index.ts              # registers web_search + web_fetch tools, /search-provider + /search-key commands, --search-provider flag
  search/
    types.ts            # SearchProvider interface, SearchResult/SearchResponse
    registry.ts         # provider list, auto-detect, selection
    keys.ts             # API-key resolution (pi registry + env; skips OAuth creds)
    keySource.ts        # foundation key-source overrides (/search-key, env)
    format.ts           # SearchResponse -> text for the LLM
    providers/          # one file per backend (anthropic, openai, gemini, tavily, brave, exa)
  fetch/
    fetch.ts            # web fetch: content negotiation, alternate link, Readability + Turndown, body fallback, llms.txt probe
```

### Adding a provider

Implement the `SearchProvider` interface in `src/search/providers/` and add it
to the `PROVIDERS` array in `src/search/registry.ts`. Foundation providers
should resolve their key via `foundationKey(ctx, ...)`; API providers via
`envKey(...)`.
