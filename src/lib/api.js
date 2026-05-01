import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

// Request interceptor to attach JWT token
api.interceptors.request.use(
  (config) => {
    const saved = localStorage.getItem('core_gym_user');
    if (saved) {
      const user = JSON.parse(saved);
      if (user.token) {
        config.headers.Authorization = `Bearer ${user.token}`;
      }
    }
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

    const shouldRetry = config && (!error.response || (error.response.status >= 500 && error.response.status < 600));

    if (shouldRetry && config.retryCount < config.retryMax) {
      config.retryCount += 1;
      const delay = new Promise((resolve) => setTimeout(resolve, config.retryCount * 1000));
      await delay;
      return api(config); // Retry the request
    }

    // 2. Auth / Suspension Logic
    if (error.response) {
      const { status, data, config: errConfig } = error.response;
      
      const isAuthPath = errConfig.url.includes('/auth/login') || 
                        errConfig.url.includes('/auth/register') || 
                        errConfig.url.includes('/auth/forgot-password') ||
                        errConfig.url.includes('/auth/change-password');

      if (!isAuthPath) {
        if (status === 403 && data?.isSuspended) {
          localStorage.removeItem('core_gym_user');
          window.location.href = '/login?suspended=1';
        } else if (status === 401) {
          localStorage.removeItem('core_gym_user');
          window.location.href = '/login?expired=1';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
