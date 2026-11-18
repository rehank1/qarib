// Anonymous usage counts for the owner's dashboard: app opens, masjids shown, Directions taps.
// What is sent: a random install id (made on this phone, never linked to a person) and those event names.
// What is never sent: location, name, email, device details. The server stores only a daily-rotating hash of the
// install id, so even the owner cannot follow one phone from day to day. Users can turn it off in Settings.
export function createMetrics({ store, backend, enabled }) {
  let queue = [], timer = 0;
  const seen = new Set();
  const on = () => enabled() && backend.mode === 'live' && typeof backend.sendEvents === 'function';
  const install = () => {
    let id = store.get('install');
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) { id = crypto.randomUUID(); store.set('install', id); }
    return id;
  };
  const flush = () => {
    clearTimeout(timer);
    if (!on() || !queue.length) { queue = []; return; }
    backend.sendEvents(install(), queue.splice(0, 20));
  };
  const push = (e) => {
    if (!on()) return;
    queue.push(e);
    clearTimeout(timer);
    timer = setTimeout(flush, 4000); // batch: one small request per few seconds of use
    if (queue.length >= 20) flush();
  };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  return {
    open: () => push({ k: 'open' }),
    view: (id) => { if (!seen.has(id)) { seen.add(id); push({ k: 'view', id }); } }, // once per masjid per session
    directions: (id) => push({ k: 'directions', id }),
    forget: () => { queue = []; store.del('install'); }, // when the user turns metrics off
  };
}
