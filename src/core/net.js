// fetch with a timeout, a JSON check and plain errors the UI can show.

export class NetError extends Error {
  constructor(message, { status = 0, code = 'network' } = {}) { super(message); this.status = status; this.code = code; }
}

export async function fetchJSON(url, { timeout = 15000, signal, ...init } = {}) {
  if (!navigator.onLine) throw new NetError('You are offline.', { code: 'offline' });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener('abort', () => ctl.abort(), { once: true }); // the caller may cancel (hedged requests)
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctl.signal, credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
  } catch (e) {
    throw new NetError(e.name === 'AbortError' ? 'The server took too long to answer.' : 'Could not reach the server.', { code: e.name === 'AbortError' ? 'timeout' : 'network' });
  } finally { clearTimeout(t); }
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new NetError(body?.msg || body?.message || body?.error_description || `Request failed (${res.status}).`, { status: res.status, code: body?.code || body?.error_code || 'http' });
  if (body === null && res.status !== 204) throw new NetError('Unexpected response from the server.', { code: 'format' });
  return body;
}
