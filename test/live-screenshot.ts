// Isolated, synthetic, no model calls or auth-storage access. Builds the adjacent
// browser-fetch, launches headless Chrome with a temporary profile, and cleans up.
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadTools } from "./tool-harness";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const gatewayRepo = resolve(root, "../browser-fetch");
const temp = await mkdtemp(join(tmpdir(), "pi-search-visual-test-"));
const children: ChildProcess[] = [];
const logs: string[] = [];
// Do not inherit production gateway secrets/configuration. All credentials below
// are literal test credentials, unrelated to any model or user profile.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("BROWSER_FETCH_") && !k.startsWith("PI_SEARCH_")));
let navigations = 0;
const fixture = createServer((req, res) => {
  if (req.url !== "/") { res.writeHead(404).end(); return; }
  navigations++;
  res.setHeader("Content-Type", "text/html");
  res.end(`<html><head><title>Synthetic Marketplace listing</title><style>
    body{margin:0;font:28px sans-serif}section{height:1300px;box-sizing:border-box;padding:40px}
    section:nth-child(odd){background:#ddf}section:nth-child(even){background:#ffd}
    .photo{width:900px;height:650px;background:#396;color:white;display:grid;place-items:center;font-size:60px}
    </style></head><body>${Array.from({length:10},(_,i)=> {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650"><rect width="900" height="650" fill="#396"/><text x="450" y="340" text-anchor="middle" font-family="sans-serif" font-size="60" fill="white">PHOTO ${i+1}</text></svg>`;
      return `<section><h1>Listing section ${i+1}</h1><p>Frozen synthetic listing. No personal account data.</p><img class="photo" alt="PHOTO ${i+1}" src="data:image/svg+xml,${encodeURIComponent(svg)}"></section>`;
    }).join("")}</body></html>`);
});
await new Promise<void>(r => fixture.listen(0, "127.0.0.1", r));
const fixtureUrl = `http://127.0.0.1:${(fixture.address() as any).port}/`;
async function port() {
  const s = createServer();
  await new Promise<void>(r => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as any).port;
  await new Promise<void>(r => s.close(() => r()));
  return p;
}
function start(command: string, args: string[]) {
  const p = spawn(command, args, { env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] });
  p.on("error", e => logs.push(String(e)));
  p.stdout?.on("data", b => logs.push(String(b)));
  p.stderr?.on("data", b => logs.push(String(b)));
  children.push(p);
  return p;
}
async function waitFor(url: string) {
  for (let i=0;i<150;i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    if (children.some(p => p.exitCode !== null || p.signalCode !== null)) throw new Error(`Test subprocess exited: ${logs.join("")}`);
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${logs.join("")}`);
}
async function stop(p: ChildProcess) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  const exited = new Promise<void>(r => p.once("exit", () => r()));
  p.kill("SIGTERM");
  const timeout = setTimeout(() => p.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timeout);
}

try {
  const binary = join(temp, "browser-fetch");
  await exec("go", ["build", "-o", binary, "."], { cwd: gatewayRepo, env: cleanEnv });
  const chromePort = await port(), gatewayPort = await port();
  const chromeUrl = `http://127.0.0.1:${chromePort}`;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  const chrome = process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
  start(chrome, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--password-store=basic", `--user-data-dir=${join(temp,"profile")}`, `--remote-debugging-port=${chromePort}`, "about:blank"]);
  await waitFor(`${chromeUrl}/json/version`);
  start(binary, ["-addr", `127.0.0.1:${gatewayPort}`, "-chrome-url", chromeUrl, "-token", "synthetic-root", "-reader-token", "synthetic-reader", "-allow-private", "-background-tabs", "-host-gap", "0", "-host-jitter", "0"]);
  await waitFor(`${gatewayUrl}/healthz`);
  // The registered tool functions, not a parallel hand-written client.
  process.env.PI_SEARCH_BROWSER_URL = gatewayUrl;
  process.env.PI_SEARCH_BROWSER_TOKEN = "synthetic-reader";
  delete process.env.PI_SEARCH_BROWSER_TOKEN_FILE;
  process.env.PI_SEARCH_FETCH_MODE = "auto";
  const tools = await loadTools();
  const first = await tools.get("web_fetch")!.execute("live-test", {url:fixtureUrl,screenshot:true});
  assert.deepEqual(first.content.map((c:any)=>c.type), ["text","image"]);
  assert.match(first.content[0].text, /Listing section 1/);
  assert.equal(first.details.screenshot.segments, 10);
  assert.equal(first.details.screenshot.truncated, true);
  assert.equal(first.details.screenshot.captured_height, 12000);
  assert.equal(first.details.llmsTxt, null);
  assert.equal("data" in first.details.screenshot.image, false);
  const before = navigations;
  const second = await tools.get("web_fetch_screenshot")!.execute("live-test", {captureId:first.details.screenshot.capture_id,segment:2});
  const last = await tools.get("web_fetch_screenshot")!.execute("live-test", {captureId:first.details.screenshot.capture_id,segment:10});
  const repeated = await tools.get("web_fetch_screenshot")!.execute("live-test", {captureId:first.details.screenshot.capture_id,segment:1});
  assert.equal(navigations, before, "continuations must not navigate");
  assert.equal(repeated.content[1].data, first.content[1].data, "capture must be immutable");
  assert.equal(second.details.y_start, 1300);
  assert.equal(last.details.y_end, 12000);
  assert.notEqual(second.content[1].data, first.content[1].data);
  assert.ok(Buffer.from(first.content[1].data,"base64").length <= 384*1024);
  process.env.PI_SEARCH_BROWSER_TOKEN = "synthetic-root";
  await assert.rejects(tools.get("web_fetch_screenshot")!.execute("live-test", {captureId:first.details.screenshot.capture_id,segment:1}), /screenshot_unavailable/);
  process.env.PI_SEARCH_BROWSER_TOKEN = "synthetic-reader";
  process.env.PI_SEARCH_FETCH_MODE = "browser-only";
  const text = await tools.get("web_fetch")!.execute("live-test", {url:fixtureUrl});
  assert.equal(text.content.length, 1);
  assert.equal(text.details.screenshot, undefined);
  const output = process.env.SCREENSHOT_TEST_OUTPUT_DIR;
  if (output) {
    await mkdir(output, {recursive:true});
    for (const [name,result] of [["segment-1",first],["segment-2",second],["segment-10",last]] as const) {
      await writeFile(join(output,`${name}.jpg`),Buffer.from(result.content[1].data,"base64"));
      await writeFile(join(output,`${name}.json`),JSON.stringify(result.details.screenshot ?? result.details,null,2));
    }
    console.log(`Saved synthetic screenshot fixtures to ${output}`);
  }
  const backend = await exec("go", ["test", "./internal/server", "-run", "^TestLivePaginatedScreenshots$", "-count=1", "-v"], {cwd:gatewayRepo,env:{...cleanEnv,BROWSER_FETCH_TEST_CHROME_URL:chromeUrl}});
  console.log(backend.stdout.trim());
  console.log("PASS: registered tools, rendered text + first image, overlapping continuations, hard height limit, immutable capture, no continuation navigation, credential isolation, text-only compatibility. No model calls or user auth/profile access.");
} finally {
  for (const p of children.reverse()) await stop(p);
  await new Promise<void>(r => fixture.close(() => r()));
  await rm(temp,{recursive:true,force:true});
}
