/**
 * Browser gateway proxy.
 *
 * Talks to browser-fetch (https://github.com/slim-bean/browser-fetch), a small
 * Go service that drives a
 * real, user-launched Chrome over CDP and returns rendered HTML. Because it is
 * a genuine browser on a residential connection, with a profile you can log
 * into by hand, it passes TLS/HTTP fingerprint checks that no server-side HTTP
 * client can — and once a human solves a challenge once, the cookie persists in
 * the profile and later fetches sail through.
 *
 *   PI_SEARCH_FETCH_PROXY=browser
 *   PI_SEARCH_BROWSER_URL=http://192.168.64.7:8377
 *   PI_SEARCH_BROWSER_TOKEN=…              (bearer token the gateway requires)
 *   PI_SEARCH_BROWSER_TIMEOUT_MS=60000     (optional)
 *   PI_SEARCH_BROWSER_ASSIST_MS=…          (optional: hold challenges for a human)
 */
import { ProxyTargetBlockedError, type ProxyResult, type ReaderProxy } from "./types";

const DEFAULT_TIMEOUT_MS = 60_000;

/** Gateway error codes that mean "the target refused", not "the proxy broke". */
const TARGET_FAILURE_CODES = new Set(["challenge", "nav_error", "rejected_url"]);

interface GatewayOK {
  url: string;
  title: string;
  html: string;
  status: number;
  page_id: number;
  assisted_ms?: number;
  request_id: string;
  duration_ms: number;
  queue_wait_ms: number;
  deduped: boolean;
}

interface GatewayError {
  error: string;
  code: string;
  vendor?: string;
  status?: number;
  request_id?: string;
}

function baseUrl(): string | undefined {
  const raw = process.env.PI_SEARCH_BROWSER_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

function timeoutMs(): number {
  const raw = Number(process.env.PI_SEARCH_BROWSER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export const browserProxy: ReaderProxy = {
  id: "browser",

  label() {
    const base = baseUrl();
    return base ? `browser ${base.replace(/^https?:\/\//, "")}` : "browser";
  },

  unavailable() {
    if (!baseUrl()) {
      return "PI_SEARCH_BROWSER_URL is not set (point it at your browser-fetch server, e.g. http://127.0.0.1:8377)";
    }
    return null;
  },

  async fetch(url, signal): Promise<ProxyResult> {
    const base = baseUrl();
    if (!base) throw new Error("PI_SEARCH_BROWSER_URL is not set");

    const budget = timeoutMs();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = process.env.PI_SEARCH_BROWSER_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const body: Record<string, unknown> = { url, timeout_ms: budget };
    const assist = Number(process.env.PI_SEARCH_BROWSER_ASSIST_MS);
    if (Number.isFinite(assist) && assist > 0) body.assist_ms = assist;

    // Give the HTTP call a little more room than the gateway's own budget so we
    // surface the gateway's structured error rather than a client-side abort.
    const timeout = AbortSignal.timeout(budget + 10_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await fetch(`${base}/fetch`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (e) {
      throw new Error(
        `browser gateway at ${base} is unreachable — ${(e as Error).message}. ` +
          `Is it running, and is Chrome up with --remote-debugging-port?`,
      );
    }

    if (res.status === 401) {
      throw new Error(
        `browser gateway rejected the token (401). Set PI_SEARCH_BROWSER_TOKEN to match the gateway's -token.`,
      );
    }

    const payload = (await res.json().catch(() => null)) as GatewayOK | GatewayError | null;
    if (!payload) throw new Error(`browser gateway returned an unreadable response (HTTP ${res.status})`);

    if (!res.ok) {
      const err = payload as GatewayError;
      const message = err.error || `HTTP ${res.status}`;
      if (TARGET_FAILURE_CODES.has(err.code)) {
        throw new ProxyTargetBlockedError(err.status ?? res.status, message, err.vendor);
      }
      throw new Error(`browser gateway error (${err.code || res.status}): ${message}`);
    }

    const ok = payload as GatewayOK;
    if (!ok.html) throw new Error("browser gateway returned an empty document");
    return { title: ok.title || null, url: ok.url || null, html: ok.html };
  },
};
