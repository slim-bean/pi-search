# pi-search

Web search and readable web fetch tools for the [pi](https://github.com/earendil-works/pi) coding agent.

Adds two LLM-callable tools:

- **`web_search`** — search the web through a pluggable backend. Returns a
  synthesized answer (foundation-model and Tavily providers) plus source URLs.
- **`web_fetch`** — fetch a URL and return clean, readable text. HTML is reduced
  to the main article via Mozilla Readability; JSON and plain text pass through.

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

## Install

This is a pi package. Add it to your pi `settings.json`:

```json
{
  "extensions": ["/path/to/pi-search/src/index.ts"]
}
```

Or symlink/copy into an auto-discovered location
(`~/.pi/agent/extensions/` or a project's `.pi/extensions/`).

Run `npm install` in this directory first so `jsdom` and
`@mozilla/readability` are available to `web_fetch`.

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
    fetch.ts            # readable web fetch (Readability + jsdom)
```

### Adding a provider

Implement the `SearchProvider` interface in `src/search/providers/` and add it
to the `PROVIDERS` array in `src/search/registry.ts`. Foundation providers
should resolve their key via `foundationKey(ctx, ...)`; API providers via
`envKey(...)`.
