import dotenv from 'dotenv';

dotenv.config();

// Authentik OIDC Configuration
const config = {
  authentikUrl: process.env.AUTHENTIK_URL || 'https://authentik.example.com',
  clientId: process.env.AUTHENTIK_CLIENT_ID || '',
  clientSecret: process.env.AUTHENTIK_CLIENT_SECRET || '',
  redirectUri: process.env.AUTHENTIK_REDIRECT_URI || 'http://localhost:3001/auth/callback',
  appSlug: process.env.AUTHENTIK_APP_SLUG || 'claude-code-ui',
  scope: 'openid profile email',
  sessionSecret: process.env.SESSION_SECRET || 'your-super-secret-session-key-change-this-in-production',
};

// Validate configuration
export const validateConfig = () => {
  const required = ['AUTHENTIK_URL', 'AUTHENTIK_CLIENT_ID', 'AUTHENTIK_CLIENT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
    return false;
  }
  return true;
};

// Initialize OIDC client
export const initializeOIDC = async () => {
  try {
    // For testing without actual Authentik instance
    if (!validateConfig() || config.authentikUrl === 'https://authentik.example.com') {
      console.warn('⚠️ Authentik not configured - authentication disabled');
      return null;
    }
    
    // Dynamically import openid-client
    const openidClient = await import('openid-client');
    const { Issuer } = openidClient;
    
    // Discover Authentik OIDC configuration
    const authentikIssuer = await Issuer.discover(`${config.authentikUrl}/application/o/${config.appSlug}/`);
    
    // Create OIDC client
    const client = new authentikIssuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uris: [config.redirectUri],
      response_types: ['code'],
    });
    
    return client;
  } catch (error) {
    console.error('Failed to initialize OIDC client:', error.message);
    return null;
  }
};

export default config;