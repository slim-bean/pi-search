import assert from "node:assert/strict";
import { test } from "node:test";
import { registerSearchLogin } from "../src/search/login";
import { listAvailable, resolveProvider } from "../src/search/registry";
import { loadExtension } from "./tool-harness";

function harness() {
  const commands = new Map<string, any>();
  const events = new Map<string, () => void>();
  const notices: string[] = [];
  let selected = "auto";
  let input: string | undefined = "  test-session-key  ";
  const ctx = {
    hasUI: true,
    modelRegistry: { getAll: () => [] },
    ui: {
      notify: (text: string) => notices.push(text),
      input: async () => input,
      select: async (_title: string, labels: string[]) => labels.find((s) => s.startsWith("brave")),
    },
  } as any;
  const state = registerSearchLogin({
    registerCommand: (name: string, command: any) => commands.set(name, command),
    on: (name: string, handler: () => void) => events.set(name, handler),
  } as any, (id) => { selected = id; });
  return { ...state, ctx, commands, events, notices, selected: () => selected, input: (value: string | undefined) => { input = value; } };
}

test("login offers Brave without credentials, selects it and overrides existing credentials", async () => {
  const h = harness();
  await h.commands.get("search-login").handler("", h.ctx);
  assert.equal(h.selected(), "brave");
  assert.equal(h.keys.get("brave"), "test-session-key");
  const result = await resolveProvider(h.ctx, "brave", h.keys);
  assert.equal(result.key, "test-session-key");
  assert.ok((await listAvailable(h.ctx, h.keys)).some((p) => p.id === "brave"));
  // A session key must bypass even OAuth-backed foundation credentials.
  h.keys.set("anthropic", "explicit-api-key");
  h.ctx.modelRegistry.getApiKeyForProvider = () => { throw new Error("must not inspect credentials"); };
  assert.equal((await resolveProvider(h.ctx, "anthropic", h.keys)).key, "explicit-api-key");
  assert.equal((await resolveProvider(h.ctx, "auto", h.keys)).provider.id, "anthropic");
  assert.ok(h.notices.every((notice) => !notice.includes("test-session-key")));
});

test("cancel, blank, malformed and non-UI login leave keys and selection unchanged", async () => {
  const h = harness();
  await h.commands.get("search-login").handler("brave", h.ctx);
  for (const input of [undefined, "  ", "bad\nkey"]) {
    h.input(input);
    await h.commands.get("search-login").handler("exa", h.ctx);
    assert.equal(h.selected(), "brave");
    assert.equal(h.keys.has("exa"), false);
  }
  await h.commands.get("search-login").handler("brave secret-in-args", h.ctx);
  assert.ok(h.notices.every((n) => !n.includes("secret-in-args")));
  h.ctx.hasUI = false;
  h.input("another-key");
  await h.commands.get("search-login").handler("exa", h.ctx);
  assert.equal(h.keys.has("exa"), false);
});

test("logout falls back to configured keys; session changes and shutdown clear memory", async () => {
  const h = harness();
  const before = process.env.BRAVE_API_KEY;
  process.env.BRAVE_API_KEY = "configured-test-key";
  try {
    await h.commands.get("search-login").handler("brave", h.ctx);
    assert.equal((await resolveProvider(h.ctx, "brave", h.keys)).key, "test-session-key");
    await h.commands.get("search-logout").handler("brave", h.ctx);
    assert.equal((await resolveProvider(h.ctx, "brave", h.keys)).key, "configured-test-key");
    assert.equal(process.env.BRAVE_API_KEY, "configured-test-key");
    for (const event of ["session_start", "session_shutdown"]) {
      await h.commands.get("search-login").handler("brave", h.ctx);
      h.events.get(event)!();
      assert.equal(h.keys.size, 0);
    }
    h.keys.set("brave", "key");
    h.keys.set("exa", "key");
    await h.commands.get("search-logout").handler("", h.ctx);
    assert.equal(h.keys.size, 0);
  } finally {
    if (before === undefined) delete process.env.BRAVE_API_KEY;
    else process.env.BRAVE_API_KEY = before;
  }
});

test("registered provider picker includes missing providers and prompts for their key", async () => {
  const { commands } = await loadExtension();
  const notices: string[] = [];
  const ctx = {
    hasUI: true,
    modelRegistry: { getAll: () => [] },
    ui: {
      notify: (text: string) => notices.push(text),
      select: async (_title: string, labels: string[]) => {
        assert.ok(labels.some((label) => label.includes("brave")));
        return labels.find((label) => label.includes("brave"));
      },
      input: async () => "picker-session-key",
    },
  } as any;
  // Force missing credentials independent of the developer's environment.
  const before = process.env.BRAVE_API_KEY;
  delete process.env.BRAVE_API_KEY;
  try {
    await commands.get("search-provider").handler("", ctx);
    assert.ok(notices.some((notice) => notice.includes("search provider: brave")));
    ctx.hasUI = false;
    await commands.get("search-provider").handler("", ctx);
    assert.ok(notices.some((notice) => notice.includes("brave") && notice.includes("(session key)")));
    assert.ok(notices.every((notice) => !notice.includes("picker-session-key")));
  } finally {
    if (before !== undefined) process.env.BRAVE_API_KEY = before;
  }
});
