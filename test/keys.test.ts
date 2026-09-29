import assert from "node:assert/strict";
import { test } from "node:test";
import { foundationKey } from "../src/search/keys";
import { listApiKeyProviders } from "../src/search/keySource";

test("current pi credential API excludes OAuth and unknown credential types", async () => {
  const ctx = { modelRegistry: {
    getAll: () => [{ provider: "oauth-test" }, { provider: "key-test" }],
    isUsingOAuth: (model: { provider: string }) => model.provider === "oauth-test",
    getProviderAuthStatus: () => ({ configured: true }),
    getApiKeyForProvider: async (id: string) => { assert.equal(id, "key-test"); return "api-key"; },
  } } as any;
  assert.equal(await foundationKey(ctx, "oauth-test"), undefined);
  assert.equal(await foundationKey(ctx, "unknown-test"), undefined);
  assert.equal(await foundationKey(ctx, "key-test"), "api-key");
  assert.deepEqual(listApiKeyProviders(ctx), ["key-test"]);
});

test("legacy authStorage is supported and inspection errors fail closed", async () => {
  const ctx = { modelRegistry: {
    authStorage: { get: (id: string) => ({ type: id === "oauth-test" ? "oauth" : "api_key" }), list: () => ["oauth-test", "key-test"] },
    getApiKeyForProvider: async (id: string) => { assert.equal(id, "key-test"); return "api-key"; },
  } } as any;
  assert.equal(await foundationKey(ctx, "oauth-test"), undefined);
  assert.equal(await foundationKey(ctx, "key-test"), "api-key");
  assert.deepEqual(listApiKeyProviders(ctx), ["key-test"]);
  ctx.modelRegistry.authStorage.get = () => { throw new Error("storage unavailable"); };
  assert.equal(await foundationKey(ctx, "key-test"), undefined);
});
