export const AUTH_CHANGED_EVENT = 'aicd-auth-changed';
export function notifyAuthChanged(): void { if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)); }
let pendingRefresh: Promise<boolean> | undefined;
/** Refresh HttpOnly-cookie sessions once after 401; no tokens are stored or exposed to browser JavaScript. */
export async function fetchWithSession(input: string, init?: RequestInit): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 401 || !input.startsWith('/api/') || input.startsWith('/api/auth/')) return first;
  if (!pendingRefresh) pendingRefresh = fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(response => { if (response.ok) notifyAuthChanged(); return response.ok; }).catch(() => false).finally(() => { pendingRefresh = undefined; });
  return await pendingRefresh ? fetch(input, init) : first;
}
