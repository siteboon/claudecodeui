// API Configuration for Cloudflare Pages deployment
const isProduction = import.meta.env.PROD;
const isCloudflarePages = window.location.hostname.includes('pages.dev') || window.location.hostname.includes('workers.dev');

// Default API base URL
let API_BASE_URL = '/api';

// If running on Cloudflare Pages, use environment variable or default to a placeholder
if (isProduction && isCloudflarePages) {
  API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://your-backend-domain.com/api';
}

// WebSocket base URL
let WS_BASE_URL = '';

if (isProduction && isCloudflarePages) {
  WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'wss://your-backend-domain.com';
} else {
  // Development: use relative URLs
  WS_BASE_URL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  WS_BASE_URL += '//' + window.location.host;
}

export const config = {
  API_BASE_URL,
  WS_BASE_URL,
  isCloudflarePages,
  isProduction
};

// Helper function to get full API URL
export const getApiUrl = (endpoint) => {
  if (endpoint.startsWith('http')) {
    return endpoint;
  }
  return `${API_BASE_URL}${endpoint}`;
};

// Helper function to get WebSocket URL
export const getWsUrl = (endpoint) => {
  if (endpoint.startsWith('ws')) {
    return endpoint;
  }
  return `${WS_BASE_URL}${endpoint}`;
};