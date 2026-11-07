import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

// Addresses a connector URL must never reach from the server: this machine,
// private networks, link-local (including cloud metadata at 169.254.169.254),
// carrier NAT, multicast and reserved ranges. IPv4-mapped IPv6 addresses
// (::ffff:10.0.0.1) are matched against the IPv4 rules by BlockList itself.
const blocked = new BlockList()
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4")
}
for (const [net, prefix] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible
  ["64:ff9b::", 96], // NAT64, embeds an IPv4 address
  ["64:ff9b:1::", 48],
  ["2002::", 16], // 6to4, embeds an IPv4 address
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6")
}

export function isBlockedAddress(address: string) {
  const family = isIP(address)
  if (!family) return true
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6")
}

// Local MCP servers on http://localhost only work when the server itself runs
// in development
const isDev = () => process.env.NODE_ENV === "development"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

// Checks a custom connector URL before the server saves or fetches it.
// Called again right before connecting, since DNS can change after saving.
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("That isn't a valid web address.")
  }
  const host = url.hostname.toLowerCase()
  if (isDev() && url.protocol === "http:" && (LOCAL_HOSTS.has(host) || host.endsWith(".localhost"))) return url
  if (url.protocol !== "https:") throw new Error("Use an https:// address for this connector.")
  if (url.username || url.password) throw new Error("Leave the username and password out of the address.")

  const bare = host.replace(/^\[|\]$/g, "")
  let addresses: string[]
  if (isIP(bare)) addresses = [bare]
  else {
    try {
      addresses = (await lookup(bare, { all: true, verbatim: true })).map((a) => a.address)
    } catch {
      throw new Error(`Couldn't find ${host}. Check the address.`)
    }
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new Error(`${host} points to a private or local network address, which connectors can't reach.`)
  }
  return url
}
