import { AuthError } from './auth-provider.ts';
import type { Actor } from './types.ts';

export const LOCAL_REQUEST_HEADER = 'x-aicd-local-request';
export const LOCAL_ACTOR: Actor = { id: 'local_mac_owner', email: 'local-owner@aicd.invalid', name: 'Local owner (this Mac)' };
export const LOCAL_DATA_PATH = '.aicd-local/state';
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
export function assertLocalRequest(request: Request, trustedInternalProxy = false): void {
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol) || !loopbackHosts.has(url.hostname)) throw new AuthError(403, 'Local mode is available only on this Mac through a loopback address.');
  const host = request.headers.get('host');
  if (host && (host.toLowerCase() !== url.host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host))) throw new AuthError(403, 'Local request host is invalid.');
  if (!trustedInternalProxy) for (const key of request.headers.keys()) {
    if (key === 'forwarded' || key.startsWith('x-forwarded-') || key === 'x-real-ip') throw new AuthError(403, 'Forwarded requests cannot use local mode.');
  }
  const origin = request.headers.get('origin');
  if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new AuthError(403, 'Open local mode directly from this Mac.');
}
export function localActor(request: Request, development: boolean, expectedToken: string | undefined): Actor {
  if (!development || !expectedToken || !/^[a-f0-9]{64}$/.test(expectedToken)) throw new AuthError(503, 'Local mode is unavailable outside the local development launcher.');
  if (request.headers.get(LOCAL_REQUEST_HEADER) !== expectedToken) throw new AuthError(403, 'Local request did not pass through the loopback launcher.');
  // Vite's Cloudflare bridge adds forwarding metadata after the public socket
  // gate. Only its unforgeable per-launch proof permits that internal metadata;
  // host/origin checks still apply, and raw incoming forwarded headers are denied.
  assertLocalRequest(request, true);
  return { ...LOCAL_ACTOR };
}
