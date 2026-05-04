import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initTheme } from './lib/theme'

// ── Cache Buster: Force-clears stale Service Workers & caches on version change ──
// Bump this version whenever you deploy a critical update
const APP_CACHE_VERSION = 'v2';

(async function cacheBuster() {
  const storedVersion = localStorage.getItem('core_gym_cache_version');
  
  if (storedVersion !== APP_CACHE_VERSION) {
    console.log(`[CacheBuster] Version mismatch (stored: ${storedVersion}, current: ${APP_CACHE_VERSION}). Purging all caches...`);
    
    // 1. Unregister ALL service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
        console.log('[CacheBuster] Unregistered SW:', reg.scope);
      }
    }
    
    // 2. Clear ALL Cache Storage entries
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
        console.log('[CacheBuster] Deleted cache:', name);
      }
    }
    
    // 3. Mark version as current
    localStorage.setItem('core_gym_cache_version', APP_CACHE_VERSION);
    
    // 4. Force a hard reload if this is a stale-to-fresh transition
    if (storedVersion !== null) {
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
