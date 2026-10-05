/** Authenticated browser-fetch transport. Chrome/profile lifecycle remains external. */
import { readFileSync } from "node:fs";
import { ProxyTargetBlockedError, type ProxyResult, type ReaderProxy } from "./types";
import { validateScreenshot, type ScreenshotSegment } from "../screenshot";

const DEFAULT_TIMEOUT_MS = 60_000;
const TARGET_FAILURE_CODES = new Set(["challenge", "nav_error", "rejected_url"]);

function baseUrl(): string | undefined {
  return process.env.PI_SEARCH_BROWSER_URL?.trim().replace(/\/+$/, "") || undefined;
}
function timeoutMs(): number {
  const raw = Number(process.env.PI_SEARCH_BROWSER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** Shared auth/error handling for captures and continuations. Never follow gateway redirects. */
async function gatewayRequest(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const base = baseUrl();
  if (!base) throw new Error("PI_SEARCH_BROWSER_URL is not set; no direct request was attempted");
  const budget = timeoutMs();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tokenFile = process.env.PI_SEARCH_BROWSER_TOKEN_FILE?.trim();
  const token = (tokenFile ? readFileSync(tokenFile, "utf8") : process.env.PI_SEARCH_BROWSER_TOKEN)?.trim();
  if (token && /[\r\n]/.test(token)) throw new Error("Browser gateway token contains an embedded newline");
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeout = AbortSignal.timeout(budget + 10_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method: "POST", redirect: "error", headers, body: JSON.stringify(body), signal: combined });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`browser gateway at ${base} is unreachable — ${(e as Error).message}. Is it running, and is Chrome up with --remote-debugging-port?`);
  }
  if (res.status === 401) {
    await res.body?.cancel();
    throw new Error("browser gateway rejected the token (401). Set PI_SEARCH_BROWSER_TOKEN or PI_SEARCH_BROWSER_TOKEN_FILE to match the gateway credential.");
  }
  // Cap the wire response too, before JSON/base64 allocation. Continuations have
  // no HTML; initial fetches retain a larger budget for rendered markup.
  const maxBytes = path === "/fetch/screenshot" ? 1024 * 1024 : 32 * 1024 * 1024;
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`browser gateway returned an unreadable response (HTTP ${res.status})`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error("browser gateway response exceeds byte limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error(`browser gateway returned an unreadable response (HTTP ${res.status})`); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("browser gateway returned an invalid response");
  if (!res.ok) {
    const message = typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`;
    const code = String(payload.code ?? res.status);
    if (TARGET_FAILURE_CODES.has(code)) throw new ProxyTargetBlockedError(Number(payload.status ?? res.status), message, typeof payload.vendor === "string" ? payload.vendor : undefined);
    const upgrade = body.screenshot === true && code === "bad_request" ? " Upgrade browser-fetch for screenshot protocol v1." : "";
    throw new Error(`browser gateway error (${code}): ${message}${upgrade}`);
  }
  return payload;
}

export async function fetchBrowserPage(url: string, signal?: AbortSignal, screenshot = false): Promise<ProxyResult> {
  const body: Record<string, unknown> = { url, timeout_ms: timeoutMs() };
  if (screenshot) body.screenshot = true;
  const assist = Number(process.env.PI_SEARCH_BROWSER_ASSIST_MS);
  if (Number.isFinite(assist) && assist > 0) body.assist_ms = assist;
  const ok = await gatewayRequest("/fetch", body, signal);
  const shot = screenshot ? validateScreenshot(ok.screenshot) : undefined;
  if (shot && (shot.segment !== 1 || shot.url !== ok.url)) throw new Error("browser gateway returned a screenshot that does not match the fetched page or first segment");
  if (typeof ok.html !== "string" || !ok.html) throw new Error("browser gateway returned an empty document");
  return { title: typeof ok.title === "string" ? ok.title : null, url: typeof ok.url === "string" ? ok.url : null, html: ok.html, ...(shot ? { screenshot: shot } : {}) };
}

export async function fetchScreenshotSegment(captureId: string, segment: number, signal?: AbortSignal): Promise<ScreenshotSegment> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(captureId) || !Number.isInteger(segment) || segment < 1 || segment > 10) {
    throw new Error("A valid captureId and segment number (1–10) are required");
  }
  const shot = validateScreenshot(await gatewayRequest("/fetch/screenshot", { capture_id: captureId, segment }, signal));
  if (shot.capture_id !== captureId || shot.segment !== segment) throw new Error("browser gateway returned a different screenshot segment than requested");
  return shot;
}

export const browserProxy: ReaderProxy = {
  id: "browser",
  label() {
    const base = baseUrl();
    return base ? `browser ${base.replace(/^https?:\/\//, "")}` : "browser";
  },
  unavailable() {
    return baseUrl() ? null : "PI_SEARCH_BROWSER_URL is not set (point it at your browser-fetch server, e.g. http://127.0.0.1:8377)";
  },
  fetch: fetchBrowserPage,
};
