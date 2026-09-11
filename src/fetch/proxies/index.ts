/**
 * Reader-proxy registry and routing.
 *
 * Proxies are opt-in: without PI_SEARCH_FETCH_PROXY, a blocked fetch simply
 * reports the block. Two knobs:
 *
 *   PI_SEARCH_FETCH_PROXY=jina|browser|off
 *   PI_SEARCH_FETCH_PROXY_HOSTS=<comma-separated hosts>
 *   PI_SEARCH_PROXY_SKIP_HOSTS=<comma-separated hosts>
 *
 * FETCH_PROXY_HOSTS skips the doomed direct attempt for hosts you know block,
 * so those fetches don't pay a wasted round trip and a 403 first.
 *
 * PROXY_SKIP_HOSTS marks hosts where a *hosted* reader proxy is known to fail
 * as well: there is no point disclosing the URL to a third party for nothing.
 * A self-hosted browser proxy is still tried, since a real browser often works
 * where a hosted reader does not.
 */
import { browserProxy } from "./browser";
import { jinaProxy } from "./jina";
import type { ReaderProxy } from "./types";

export { ProxyTargetBlockedError } from "./types";
export type { ProxyResult, ReaderProxy } from "./types";

export const PROXIES: ReaderProxy[] = [jinaProxy, browserProxy];

/** The proxy selected via PI_SEARCH_FETCH_PROXY, or undefined when disabled. */
export function selectedProxy(): ReaderProxy | undefined {
  const id = process.env.PI_SEARCH_FETCH_PROXY?.trim().toLowerCase();
  if (!id || id === "off" || id === "none") return undefined;
  return PROXIES.find((p) => p.id === id);
}

function hostList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

function matches(hostname: string, list: string[]): boolean {
  const host = hostname.toLowerCase();
  return list.some((h) => host === h || host.endsWith("." + h));
}

/** Hosts routed straight to a proxy, skipping the direct fetch. */
export function proxyHosts(): string[] {
  return hostList(process.env.PI_SEARCH_FETCH_PROXY_HOSTS);
}

/** True when hostname is, or is a subdomain of, a configured proxy host. */
export function isProxyHost(hostname: string): boolean {
  return matches(hostname, proxyHosts());
}

/** True when hosted reader proxies are known to be refused by this host. */
export function skipsHostedProxies(hostname: string): boolean {
  return matches(hostname, hostList(process.env.PI_SEARCH_PROXY_SKIP_HOSTS));
}
