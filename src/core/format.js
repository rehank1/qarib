// Human-friendly time phrases.

export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** "in 2 h 05 min", or "in 12:07" in the last hour (seconds matter then). */
export function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `in ${h} h ${String(m).padStart(2, '0')} min`;
  return `in ${m}:${String(sec).padStart(2, '0')}`;
}

export const daysSince = (ts, now = Date.now()) => (now - new Date(ts).getTime()) / 864e5;
