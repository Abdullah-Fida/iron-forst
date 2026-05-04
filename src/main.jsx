import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initTheme } from './lib/theme'

// ── Cache Buster: Force-clears stale Service Workers & caches on version change ──
// Bump this version whenever you deploy a critical update
const APP_CACHE_VERSION = 'v3';

// Auto-purge interval: force re-check caches every 24 hours even if version matches
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function purgeAllCaches() {
  // 1. Unregister ALL service workers
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
        console.log('[CacheBuster] Unregistered SW:', reg.scope);
      }
    } catch (e) {
      console.warn('[CacheBuster] SW unregister failed:', e);
    }
  }

  // 2. Clear ALL Cache Storage entries
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
        console.log('[CacheBuster] Deleted cache:', name);
      }
    } catch (e) {
      console.warn('[CacheBuster] Cache delete failed:', e);
    }
  }
}

(async function cacheBuster() {
  const storedVersion = localStorage.getItem('core_gym_cache_version');
  const lastPurge = parseInt(localStorage.getItem('core_gym_last_purge') || '0', 10);
  const now = Date.now();
  const isStaleAge = (now - lastPurge) > CACHE_MAX_AGE_MS;

  // Purge if version changed OR if caches are older than 24 hours
  if (storedVersion !== APP_CACHE_VERSION || isStaleAge) {
    const reason = storedVersion !== APP_CACHE_VERSION
      ? `Version mismatch (stored: ${storedVersion}, current: ${APP_CACHE_VERSION})`
      : `Cache age exceeded ${CACHE_MAX_AGE_MS / 3600000}h`;
    console.log(`[CacheBuster] ${reason}. Purging all caches...`);

    await purgeAllCaches();

    // Mark version + timestamp as current
    localStorage.setItem('core_gym_cache_version', APP_CACHE_VERSION);
    localStorage.setItem('core_gym_last_purge', String(now));

    // Force a hard reload if this is a stale-to-fresh transition (not first visit)
    if (storedVersion !== null && storedVersion !== APP_CACHE_VERSION) {
      console.log('[CacheBuster] Hard reloading to pick up fresh assets...');
      window.location.reload();
      // Don't continue — page will reload
      return;
    }
  }

  // ── Normal app boot ──
  initTheme()

  createRoot(document.getElementById('root')).render(
    <App />
  )
})();
