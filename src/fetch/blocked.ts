/**
 * Bot-protection detection for web_fetch.
 *
 * Two failure shapes matter:
 *  - Plain HTTP 401/403/429/503 from a WAF.
 *  - HTTP 200 whose body is a JavaScript challenge or captcha interstitial
 *    rather than the page. Handing such a body to the model as a successful
 *    fetch is worse than an error, because it looks like content.
 *
 * Both are TLS/HTTP-fingerprint based in practice — a browser User-Agent and
 * extra headers do not get through — so we report honestly and suggest
 * alternatives rather than retrying with disguises.
 *
 * Markers here are kept in sync with the Go detector in the browser-fetch
 * project, so a direct fetch and a browser-rendered one agree on what
 * "blocked" means.
 */

export const BLOCK_STATUSES = new Set([401, 403, 429, 503]);

export interface BlockInfo {
  /** What kind of protection answered, best effort. */
  vendor: string;
  /** HTTP status of the blocking response (0 when we never attempted one). */
  status: number;
  /** True when the block arrived as a 200 challenge page rather than an error status. */
  challenge: boolean;
  /** True when we skipped the direct fetch because the host is configured as always-blocking. */
  preRouted?: boolean;
}

export class BlockedError extends Error {
  constructor(
    readonly url: string,
    readonly info: BlockInfo,
    message: string,
  ) {
    super(message);
    this.name = "BlockedError";
  }
}

function vendorFromHeaders(headers: Headers): string | null {
  const server = (headers.get("server") || "").toLowerCase();
  if (headers.get("cf-mitigated") || server.includes("cloudflare")) return "Cloudflare";
  if (server.includes("akamai") || server.includes("akamaighost")) return "Akamai";
  if (headers.get("x-datadome") || headers.get("x-dd-b")) return "DataDome";
  if (headers.get("x-iinfo")) return "Imperva";
  return null;
}

/** Visible-text budget below which a captcha-bearing page *is* the captcha. */
const INTERSTITIAL_TEXT_LIMIT = 1200;

function visibleTextLength(html: string): number {
  return html
    .replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** Detect a challenge/interstitial page served with a 2xx status. Returns the vendor or null. */
export function detectChallengePage(html: string, headers: Headers): string | null {
  if (headers.get("cf-mitigated") === "challenge") return "Cloudflare";
  // Only look at the head of the document; challenge pages are small.
  const sample = html.slice(0, 20_000);

  // A hidden input the page posts back after its script runs.
  if (/name="js_challenge"/.test(sample)) return "JS challenge";
  if (
    /<title>\s*Just a moment\.{0,3}\s*<\/title>|cf-chl-|challenge-platform|cf_chl_opt|\/cdn-cgi\/challenge/i.test(
      sample,
    ) ||
    /challenges\.cloudflare\.com\/turnstile|cf-turnstile/i.test(sample)
  ) {
    return "Cloudflare";
  }
  if (/_Incapsula_Resource|incapsula/i.test(sample)) return "Imperva";
  if (/px-captcha|_pxhd|perimeterx/i.test(sample)) return "PerimeterX";
  if (/geo\.captcha-delivery\.com|datadome/i.test(sample)) return "DataDome";
  if (/<title>\s*Access Denied\s*<\/title>/i.test(sample) && /permission to access/i.test(sample)) {
    return "Akamai";
  }

  // An interstitial that asks the visitor to prove they are human, posting the
  // answer back to the same path.
  const humanityGate =
    /prove your humanity|are you a robot|verify you are (a )?human/i.test(sample) ||
    /action="[^"]*[?&]captcha=1"/i.test(sample);

  // A captcha widget alone proves nothing — plenty of real pages embed one in a
  // login or comment form. Only a near-empty page built around one is a block.
  if (humanityGate || visibleTextLength(html) < INTERSTITIAL_TEXT_LIMIT) {
    if (/class="g-recaptcha"|google\.com\/recaptcha\/api\.js|g-recaptcha-response/i.test(sample)) {
      return "reCAPTCHA";
    }
    if (/hcaptcha\.com\/1\/api\.js|h-captcha-response|class="h-captcha"/i.test(sample)) {
      return "hCaptcha";
    }
    if (humanityGate) return "humanity check";
  }
  return null;
}

/** Classify a non-OK response as a block, or return null if it's an ordinary error. */
export function classifyBlockedResponse(response: Response): BlockInfo | null {
  if (!BLOCK_STATUSES.has(response.status)) return null;
  return {
    vendor: vendorFromHeaders(response.headers) ?? "bot protection",
    status: response.status,
    challenge: false,
  };
}

export function blockedMessage(url: string, info: BlockInfo, proxyTried: boolean): string {
  const host = new URL(url).hostname;
  const how = info.preRouted
    ? "is configured as a known-blocking host (PI_SEARCH_FETCH_PROXY_HOSTS), so the direct fetch was skipped"
    : info.challenge
      ? `returned a ${info.vendor} interstitial instead of the content (HTTP ${info.status})`
      : `blocked the request (HTTP ${info.status}, ${info.vendor})`;

  const lines = [`web_fetch: ${host} ${how}.`];
  if (!info.preRouted) {
    lines.push("This is fingerprint-based bot protection; retrying with different headers will not help.");
  }
  if (proxyTried) {
    lines.push("The configured reader proxy could not retrieve it either.");
  }

  lines.push(
    "Options: use web_search for this content or find an alternative source. " +
      "If this host should be readable, a reader proxy can be enabled " +
      "(PI_SEARCH_FETCH_PROXY=jina for a hosted reader, or =browser for a self-hosted " +
      "browser-fetch server); see the pi-search README. Some hosts refuse hosted readers " +
      "but allow a real browser, and some require being signed in.",
  );
  return lines.join(" ");
}
