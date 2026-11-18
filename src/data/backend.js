// Picks the backend: Supabase when configured, the on-device demo otherwise (development only). Views only see this
// interface: mode · user() · times(ids) · signUp · signIn · signOut · myMasjids · claim · saveTimes
// (live only: masjids · refreshUser · stats · pendingClaims · decideClaim · setUpdateNotice · appConfig · sendEvents)
import { CONFIG } from '../config.js';
import { supabaseBackend } from './supabase.js';
import { demoBackend } from './demo.js';

export function createBackend(store) {
  if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) return supabaseBackend({ url: CONFIG.supabaseUrl, anonKey: CONFIG.supabaseAnonKey, store });
  return demoBackend({ store });
}
