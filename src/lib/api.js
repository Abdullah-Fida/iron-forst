import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  },
});

// Request interceptor to attach JWT token and bust HTTP caches
api.interceptors.request.use(
  (config) => {
    const saved = localStorage.getItem('core_gym_user');
    if (saved) {
      const user = JSON.parse(saved);
      if (user.token) {
        config.headers.Authorization = `Bearer ${user.token}`;
      }
    }
    // Cache-busting: append unique timestamp to prevent HTTP-level caching
    // (Chromebooks / some browsers aggressively cache GET responses)
    config.params = { ...config.params, _t: Date.now() };
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for global suspension, session expiration, and automatic retries
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    // 1. Automatic Retry Logic for Network Errors / 5xx Server Errors
    if (config && config.retryCount === undefined) {
      config.retryCount = 0;
      config.retryMax = 3; // Retry up to 3 times
    }

    // Only page loads (GET) are retried. Retrying a save could save it twice:
    // if the first attempt reached the server but the reply was slow or lost,
    // the repeat created a second payment, or failed as a duplicate member and
    // showed "Internal server error".
    const method = String(config?.method || 'get').toLowerCase();
    const shouldRetry = config && method === 'get' && (!error.response || (error.response.status >= 500 && error.response.status < 600));

    if (shouldRetry && config.retryCount < config.retryMax) {
      config.retryCount += 1;
      const delay = new Promise((resolve) => setTimeout(resolve, config.retryCount * 1000));
      await delay;
      return api(config); // Retry the request
    }

    // No reply at all (offline, server restarting): give screens a clear message
    if (!error.response) {
      error.response = {
        status: 0,
        data: { success: false, message: navigator.onLine === false ? 'No internet connection. Please check the internet and try again.' : 'Cannot reach the server right now. Please wait a moment and try again.' },
        config: config || {},
      };
      return Promise.reject(error);
    }

    // 2. Auth / Suspension Logic
    if (error.response) {
      const { status, data, config: errConfig } = error.response;

      const isAuthPath = errConfig.url.includes('/auth/login') ||
        errConfig.url.includes('/auth/register') ||
        errConfig.url.includes('/auth/forgot-password') ||
        errConfig.url.includes('/auth/change-password');

      if (!isAuthPath) {
        if (status === 401) {
          localStorage.removeItem('core_gym_user');
          window.location.href = '/login?expired=1';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
