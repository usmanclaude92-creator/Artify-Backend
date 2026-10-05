/**
 * SSRF guard for every server-initiated request to a user-supplied URL
 * (outbound webhooks, integration connectivity tests). Rejects non-HTTPS
 * (HTTP is allowed outside production only), embedded credentials, and any
 * host that resolves to a loopback/private/link-local/metadata address.
 * Checked at save time AND again at delivery time (DNS can change).
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { config } from "../config/env";
import { ValidationError } from "../core/errors";

const blocked = new BlockList();
for (const [net, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"], // link-local + cloud metadata (169.254.169.254)
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const) {
  blocked.addSubnet(net, prefix, family);
}

function isBlockedAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped IPv6
  const ip = mapped ? mapped[1]! : address;
  const family = isIP(ip) === 6 ? "ipv6" : "ipv4";
  return blocked.check(ip, family);
}

export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("URL is not valid.");
  }
  const httpsOnly = config.nodeEnv === "production" || config.nodeEnv === "staging";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !httpsOnly)) {
    throw new ValidationError(httpsOnly ? "URL must use https." : "URL must use http or https.");
  }
  if (url.username || url.password) throw new ValidationError("URL must not contain credentials.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new ValidationError("URL host could not be resolved.");
  // Non-production keeps loopback usable so local receivers/tests work; every
  // other private range stays blocked everywhere.
  const allowLoopback = !httpsOnly;
  for (const { address } of addresses) {
    const loopback = address === "127.0.0.1" || address === "::1";
    if (isBlockedAddress(address) && !(allowLoopback && loopback)) {
      throw new ValidationError("URL resolves to a private or reserved address, which is not allowed.");
    }
  }
  return url;
}
