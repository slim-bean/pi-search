// Load extension factories with pi's peer aliases, but NEVER construct a pi
// session, ModelRegistry or AuthStorage. No user credential files are read.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Tool = { name: string; parameters: any; execute: (...args: any[]) => Promise<any> };

export async function loadTools(): Promise<Map<string, Tool>> {
  const root = process.env.PI_ROOT ?? resolve(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
  const require = createRequire(resolve(root, "package.json"));
  const { createJiti } = require("jiti");
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { typebox: resolve(root, "node_modules/typebox/build/index.mjs"), "@earendil-works/pi-ai": resolve(root, "node_modules/@earendil-works/pi-ai/dist/index.js") },
  });
  const factory = await jiti.import(fileURLToPath(new URL("../src/index.ts", import.meta.url)), { default: true });
  const tools = new Map<string, Tool>();
  factory({
    registerTool(tool: Tool) { tools.set(tool.name, tool); },
    registerFlag() {}, getFlag() {}, registerCommand() {}, on() {}, events: { on() {} },
  });
  return tools;
}
