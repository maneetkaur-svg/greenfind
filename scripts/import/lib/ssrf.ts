import dns from 'node:dns/promises';
import net from 'node:net';

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function ipv4ToLong(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

/** RFC 1918/5735-ish private, loopback, link-local and other non-public v4 blocks. */
const PRIVATE_V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export function isPrivateIPv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const n = ipv4ToLong(ip);
  return PRIVATE_V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToLong(base) & mask);
  });
}

export function isPrivateIPv6(ip: string): boolean {
  const l = ip.toLowerCase();
  if (l === '::1' || l === '::') return true;
  if (l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd')) return true;
  if (l.startsWith('::ffff:')) return isPrivateIPv4(l.slice(7));
  return false;
}

/** Validates scheme and blocks loopback/private/link-local targets. Resolves
 *  DNS for hostnames so a public-looking name that points at a private IP is
 *  still caught — call this again on every redirect hop, not just the first. */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new SsrfBlockedError(`Blocked scheme: ${url.protocol}`);

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost'))
    throw new SsrfBlockedError('Blocked host: localhost');

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    if (isPrivateIPv4(hostname)) throw new SsrfBlockedError('Blocked private/loopback IP');
    return url;
  }
  if (ipVersion === 6) {
    if (isPrivateIPv6(hostname)) throw new SsrfBlockedError('Blocked private/loopback IPv6');
    return url;
  }

  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length) throw new SsrfBlockedError('Host does not resolve');
  for (const a of addrs) {
    if (a.family === 4 && isPrivateIPv4(a.address)) throw new SsrfBlockedError('Host resolves to a private/loopback IP');
    if (a.family === 6 && isPrivateIPv6(a.address)) throw new SsrfBlockedError('Host resolves to a private/loopback IPv6');
  }
  return url;
}
