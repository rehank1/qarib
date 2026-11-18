// Picks the backend: the live Qarīb API when configured, the on-device demo otherwise. Views only see this interface:
// mode · user() · times(ids) · signUp · signIn · signOut · resetPassword · myMasjids · claim · saveTimes
// (live only: masjids · stats · pendingClaims · decideClaim · sendEvents)
import { CONFIG } from '../config.js';
import { apiBackend } from './api.js';
import { demoBackend } from './demo.js';

export function createBackend(store) {
  if (CONFIG.apiUrl) return apiBackend({ url: CONFIG.apiUrl, store });
  return demoBackend({ store });
}
