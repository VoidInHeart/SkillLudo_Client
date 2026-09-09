/** Empty Inspector value selects the deployment automatically; an explicit URL always wins. */
export const PREVIEW_SERVER_URL = 'ws://81.70.145.148';

export interface PageAddress { protocol: string; hostname: string; host: string }

function isPreviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host === '[::1]' || host === '::1' || host === '0.0.0.0'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export function resolveServerUrl(configured = '', page?: PageAddress): string {
  if (configured.trim()) return configured.trim();
  if (page && (page.protocol === 'http:' || page.protocol === 'https:') && page.host && !isPreviewHost(page.hostname)) {
    return `${page.protocol === 'https:' ? 'wss' : 'ws'}://${page.host}`;
  }
  // Creator previews and runtimes without a browser location use the public test server.
  return PREVIEW_SERVER_URL;
}
