# Authentik Integration Guide - Claude Code UI

This guide details how to migrate Claude Code UI from its original local authentication system to Authentik OIDC authentication.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Step 1: Authentik Configuration](#step-1-authentik-configuration)
- [Step 2: Backend Code Modifications](#step-2-backend-code-modifications)
- [Step 3: Frontend Code Modifications](#step-3-frontend-code-modifications)
- [Step 4: Environment Configuration](#step-4-environment-configuration)
- [Step 5: Testing and Running](#step-5-testing-and-running)
- [Security Considerations](#security-considerations)

## Overview

This migration will implement:
- Authentik as a Single Sign-On (SSO) provider
- OAuth2/OIDC standard protocol
- Session-based authentication replacing JWT tokens
- Development mode support for quick testing

## Prerequisites

1. **Authentik Instance**
   - Deployed Authentik server
   - Admin permissions to create applications

2. **Required Packages**
   ```bash
   npm install openid-client express-session connect-redis redis
   ```

## Step 1: Authentik Configuration

### 1.1 Create OAuth2 Provider

1. Log in to Authentik admin interface
2. Navigate to **Applications** → **Providers**
3. Click **Create** → Select **OAuth2/OpenID Provider**
4. Configure as follows:
   ```
   Name: Claude Code UI Provider
   Authorization flow: default-provider-authorization-explicit-consent
   Client type: Confidential
   Client ID: [Auto-generated or custom]
   Client Secret: [Auto-generated]
   Redirect URIs: http://localhost:3001/auth/callback
   ```

### 1.2 Create Application

1. Navigate to **Applications** → **Applications**
2. Click **Create**
3. Configure:
   ```
   Name: Claude Code UI
   Slug: claude-code-ui
   Provider: Claude Code UI Provider (created in previous step)
   ```

## Step 2: Backend Code Modifications

### 2.1 Remove Old Authentication Files
```bash
rm server/middleware/auth.js
rm server/routes/auth.js
rm server/database/db.js
rm server/database/init.sql
```

### 2.2 Create Authentik Configuration File

Create `server/config/authentik.js`:
```javascript
import dotenv from 'dotenv';
dotenv.config();

const config = {
  authentikUrl: process.env.AUTHENTIK_URL || 'https://authentik.example.com',
  clientId: process.env.AUTHENTIK_CLIENT_ID || '',
  clientSecret: process.env.AUTHENTIK_CLIENT_SECRET || '',
  redirectUri: process.env.AUTHENTIK_REDIRECT_URI || 'http://localhost:3001/auth/callback',
  appSlug: process.env.AUTHENTIK_APP_SLUG || 'claude-code-ui',
  scope: 'openid profile email',
  sessionSecret: process.env.SESSION_SECRET || 'your-super-secret-session-key-change-this-in-production',
};

export const validateConfig = () => {
  const required = ['AUTHENTIK_URL', 'AUTHENTIK_CLIENT_ID', 'AUTHENTIK_CLIENT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
    return false;
  }
  return true;
};

export const initializeOIDC = async () => {
  try {
    if (!validateConfig() || config.authentikUrl === 'https://authentik.example.com') {
      console.warn('⚠️ Authentik not configured - authentication disabled');
      return null;
    }
    
    const openidClient = await import('openid-client');
    const { Issuer } = openidClient;
    
    const authentikIssuer = await Issuer.discover(
      `${config.authentikUrl}/application/o/${config.appSlug}/`
    );
    
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
```

### 2.3 Create Authentik Routes

Create `server/routes/authentik.js`:
```javascript
import express from 'express';
import config, { initializeOIDC } from '../config/authentik.js';

const router = express.Router();
let oidcClient = null;
let generators = null;

// Initialize OIDC client
(async () => {
  try {
    const openidClient = await import('openid-client');
    generators = openidClient.generators;
    
    oidcClient = await initializeOIDC();
    if (oidcClient) {
      console.log('Authentik OIDC client initialized successfully');
    } else {
      console.log('Authentik OIDC client not configured - authentication disabled');
    }
  } catch (error) {
    console.error('Failed to initialize Authentik OIDC client:', error);
  }
})();

// Initiate login flow
router.get('/login', (req, res) => {
  if (!oidcClient) {
    return res.status(503).json({ 
      error: 'Authentication service not configured. Please configure Authentik.' 
    });
  }
  
  const state = generators.state();
  const nonce = generators.nonce();
  
  req.session.state = state;
  req.session.nonce = nonce;
  
  const authorizationUrl = oidcClient.authorizationUrl({
    scope: config.scope,
    state,
    nonce,
  });
  
  res.json({ authorizationUrl });
});

// Handle OAuth callback
router.get('/callback', async (req, res) => {
  if (!oidcClient) {
    return res.redirect('/?error=auth_unavailable');
  }
  
  try {
    const params = oidcClient.callbackParams(req);
    
    if (params.state !== req.session.state) {
      throw new Error('State mismatch');
    }
    
    const tokenSet = await oidcClient.callback(config.redirectUri, params, {
      state: req.session.state,
      nonce: req.session.nonce,
    });
    
    const userinfo = await oidcClient.userinfo(tokenSet);
    
    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.redirect('/?error=session_error');
      }
      
      req.session.user = {
        id: userinfo.sub,
        username: userinfo.preferred_username || userinfo.name || userinfo.email,
        email: userinfo.email,
        name: userinfo.name,
        groups: userinfo.groups || [],
      };
      
      req.session.tokenSet = tokenSet;
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.redirect('/?error=session_error');
        }
        res.redirect('/');
      });
    });
  } catch (error) {
    console.error('Authentication callback error:', error);
    res.redirect('/?error=auth_failed');
  }
});

// Logout
router.post('/logout', async (req, res) => {
  if (!oidcClient || !req.session.tokenSet) {
    req.session.destroy();
    return res.json({ success: true });
  }
  
  try {
    const tokenSet = req.session.tokenSet;
    
    if (tokenSet.access_token) {
      await oidcClient.revoke(tokenSet.access_token, 'access_token');
    }
    
    const endSessionUrl = oidcClient.endSessionUrl({
      id_token_hint: tokenSet.id_token,
      post_logout_redirect_uri: `${req.protocol}://${req.get('host')}/`,
    });
    
    req.session.destroy();
    res.json({ success: true, logoutUrl: endSessionUrl });
  } catch (error) {
    console.error('Logout error:', error);
    req.session.destroy();
    res.json({ success: true });
  }
});

// Check authentication status
router.get('/status', (req, res) => {
  res.json({
    isAuthenticated: !!req.session.user,
    user: req.session.user || null,
    configured: !!oidcClient
  });
});

export default router;
```

### 2.4 Create Development Mode Routes (Optional)

Create `server/routes/dev-auth.js`:
```javascript
import express from 'express';

const router = express.Router();

// Development mode authentication bypass
router.get('/login', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ 
      error: 'Development auth not available in production' 
    });
  }
  
  req.session.user = {
    id: 'dev-user-001',
    username: 'developer',
    email: 'dev@localhost',
    name: 'Development User',
    groups: ['developers', 'admin']
  };
  
  res.json({ 
    success: true, 
    message: 'Development mode - logged in without authentication',
    user: req.session.user 
  });
});

router.get('/status', (req, res) => {
  res.json({
    isAuthenticated: !!req.session.user,
    user: req.session.user || null,
    devMode: true,
    configured: false
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, devMode: true });
});

export default router;
```

### 2.5 Modify Main Server File

Modify `server/index.js` key changes:

```javascript
import express from 'express';
import session from 'express-session';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// ... other imports

import authentikRoutes from './routes/authentik.js';
import devAuthRoutes from './routes/dev-auth.js';

// Remove old auth imports
// import authRoutes from './routes/auth.js';
// import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';

const app = express();

async function setupServer() {
    // Redis session store (optional)
    let sessionStore = undefined;
    if (process.env.REDIS_URL) {
        try {
            const { RedisStore } = await import('connect-redis');
            const redisClient = createClient({
                url: process.env.REDIS_URL
            });
            await redisClient.connect();
            sessionStore = new RedisStore({
                client: redisClient,
                prefix: 'claude-ui:'
            });
            console.log('✅ Redis connected for session storage');
        } catch (error) {
            console.error('Redis connection failed, using memory store:', error.message);
        }
    }

    // Check SESSION_SECRET in production
    if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
        console.error('❌ SESSION_SECRET must be set in production!');
        process.exit(1);
    }
    
    // Session middleware
    app.use(session({
        store: sessionStore,
        secret: process.env.SESSION_SECRET || 'your-super-secret-session-key-change-this',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    }));

    setupMiddleware();
}

function setupMiddleware() {
    // CORS configuration
    app.use(cors({
        origin: process.env.NODE_ENV === 'production' 
            ? process.env.ALLOWED_ORIGINS?.split(',') || false
            : true,
        credentials: true
    }));
    
    app.use(express.json());

    // Authentication middleware
    const requireAuth = (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        next();
    };

    // Authentication routes
    if (process.env.DEV_AUTH_BYPASS === 'true') {
        console.log('⚠️  Development authentication bypass enabled');
        app.use('/auth', devAuthRoutes);
    } else {
        app.use('/auth', authentikRoutes);
    }

    // Protected API routes
    app.use('/api/git', requireAuth, gitRoutes);
    app.use('/api/mcp', requireAuth, mcpRoutes);
    app.get('/api/config', requireAuth, (req, res) => {
        // ... config endpoint
    });
    
    // All other API endpoints add requireAuth middleware
    // app.get('/api/projects', requireAuth, async (req, res) => { ... });
}

// WebSocket configuration
const wss = new WebSocketServer({
    server,
    verifyClient: (info, callback) => {
        console.log('WebSocket connection attempt to:', info.req.url);
        
        const cookies = info.req.headers.cookie;
        if (!cookies) {
            console.log('❌ WebSocket rejected: No cookies');
            return callback(false, 401, 'Unauthorized');
        }
        
        callback(true);
    }
});

// Start server
startServer();
```

## Step 3: Frontend Code Modifications

### 3.1 Modify AuthContext

Modify `src/contexts/AuthContext.jsx`:

```javascript
import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext({
  user: null,
  login: () => {},
  logout: () => {},
  isLoading: true,
  error: null
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('/auth/status', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.isAuthenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth status check failed:', error);
      setError('Failed to check authentication status');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async () => {
    try {
      setError(null);
      
      const response = await fetch('/auth/login', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Redirect to Authentik login page
        window.location.href = data.authorizationUrl;
        return { success: true };
      } else {
        const data = await response.json();
        setError(data.error || 'Login initialization failed');
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage = 'Failed to initialize login';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const logout = async () => {
    try {
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setUser(null);
        
        if (data.logoutUrl) {
          window.location.href = data.logoutUrl;
        } else {
          window.location.reload();
        }
      } else {
        setUser(null);
        window.location.reload();
      }
    } catch (error) {
      console.error('Logout error:', error);
      setUser(null);
      window.location.reload();
    }
  };

  const value = {
    user,
    login,
    logout,
    isLoading,
    error
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
```

### 3.2 Modify API Utility Functions

Modify `src/utils/api.js`:

```javascript
// API calls using session cookies
export const authenticatedFetch = (url, options = {}) => {
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };
  
  return fetch(url, {
    ...options,
    credentials: 'include', // Include cookies
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};

// Remove all token-related code
// No longer need Authorization header
```

### 3.3 Modify WebSocket Connection

Modify `src/utils/websocket.js`:

```javascript
const connect = async () => {
  try {
    // Fetch server configuration
    let wsBaseUrl;
    try {
      const configResponse = await fetch('/api/config', {
        credentials: 'include'  // Use session cookies
      });
      const config = await configResponse.json();
      wsBaseUrl = config.wsUrl;
    } catch (error) {
      console.warn('Could not fetch server config');
      // fallback logic
    }
    
    // Create WebSocket connection (cookies sent automatically)
    const wsUrl = `${wsBaseUrl}/ws`;
    const websocket = new WebSocket(wsUrl);
    
    // ... WebSocket event handling
  } catch (error) {
    console.error('WebSocket connection error:', error);
  }
};
```

### 3.4 Modify Login Component

Modify `src/components/LoginForm.jsx`:

```javascript
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MessageSquare, LogIn, Shield } from 'lucide-react';

const LoginForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { login } = useAuth();

  const handleLogin = async () => {
    setError('');
    setIsLoading(true);
    
    const result = await login();
    
    if (!result.success) {
      setError(result.error);
      setIsLoading(false);
    }
    // Success will redirect to Authentik
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full space-y-8 p-8 bg-card rounded-lg shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to Claude Code UI</h1>
          <p className="text-muted-foreground mt-2">
            Sign in with your Authentik account
          </p>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-muted/50 rounded-lg border">
            <div className="flex items-center space-x-2 mb-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <span className="font-medium">Secure Authentication</span>
            </div>
            <p className="text-sm text-muted-foreground">
              You will be redirected to Authentik to securely sign in.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-100 text-red-700 rounded-md text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-md"
          >
            <LogIn className="w-5 h-5 inline mr-2" />
            <span>{isLoading ? 'Redirecting...' : 'Sign In with Authentik'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
```

### 3.5 Remove SetupForm Component

Delete `src/components/SetupForm.jsx` - no longer needed for initial setup flow.

## Step 4: Environment Configuration

### 4.1 Create .env File

```bash
# =============================================================================
# AUTHENTIK OIDC CONFIGURATION
# =============================================================================

# Authentik instance URL
AUTHENTIK_URL=https://your-authentik-domain.com

# OAuth2/OIDC client credentials
AUTHENTIK_CLIENT_ID=your-client-id-from-authentik
AUTHENTIK_CLIENT_SECRET=your-client-secret-from-authentik

# Callback URI (must match Authentik configuration)
AUTHENTIK_REDIRECT_URI=http://localhost:3001/auth/callback

# Authentik application slug
AUTHENTIK_APP_SLUG=claude-code-ui

# =============================================================================
# SESSION CONFIGURATION
# =============================================================================

# Session secret (use strong random string in production)
SESSION_SECRET=your-very-strong-random-session-secret-here

# =============================================================================
# SECURITY CONFIGURATION
# =============================================================================

# Allowed CORS origins in production (comma-separated)
ALLOWED_ORIGINS=https://your-production-domain.com

# =============================================================================
# OPTIONAL CONFIGURATION
# =============================================================================

# Redis URL (optional, for session storage)
# REDIS_URL=redis://localhost:6379

# Development mode: bypass Authentik authentication (development only)
# DEV_AUTH_BYPASS=true

# Environment
NODE_ENV=development

# Ports
PORT=3001
VITE_PORT=5173
```

### 4.2 Production Configuration

Production environment must set:
- `NODE_ENV=production`
- Strong random `SESSION_SECRET`
- Proper `ALLOWED_ORIGINS`
- Use HTTPS
- Configure Redis for session storage

## Step 5: Testing and Running

### 5.1 Development Mode (No Authentik Required)

```bash
# Set environment variable
echo "DEV_AUTH_BYPASS=true" >> .env

# Install dependencies
npm install

# Start development server
npm run dev
```

Visit http://localhost:5173, click login to automatically sign in as development user.

### 5.2 Authentik Mode

```bash
# Ensure .env is properly configured
# Comment out DEV_AUTH_BYPASS or set to false

# Start server
npm run dev
```

Visit http://localhost:5173, click login to redirect to Authentik.

### 5.3 Production Deployment

```bash
# Build frontend
npm run build

# Set production environment variables
export NODE_ENV=production

# Start production server
npm run start
```

## Security Considerations

### Required Security Measures

1. **Session Security**
   - ✅ Use httpOnly cookies
   - ✅ Use secure cookies in production (HTTPS)
   - ✅ Set SameSite attribute to prevent CSRF
   - ✅ Session regeneration to prevent fixation attacks

2. **Production Environment Checks**
   - ✅ Enforce SESSION_SECRET requirement
   - ✅ Disable development mode authentication
   - ✅ Configure CORS whitelist

3. **Authentication Flow**
   - ✅ State parameter to prevent CSRF
   - ✅ Nonce to prevent replay attacks
   - ✅ Token revocation support

### Recommended Additional Security Measures

1. **Rate Limiting**
   ```javascript
   import rateLimit from 'express-rate-limit';
   
   const authLimiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 5 // limit to 5 requests
   });
   
   app.use('/auth/login', authLimiter);
   ```

2. **Helmet.js Security Headers**
   ```javascript
   import helmet from 'helmet';
   app.use(helmet());
   ```

3. **Monitoring and Logging**
   - Log all authentication events
   - Monitor abnormal login activity
   - Set up alerting mechanisms

## Troubleshooting

### Common Issues

1. **"Authentication service not configured"**
   - Check Authentik configuration in .env file
   - Ensure Authentik service is accessible

2. **"State mismatch" error**
   - Check session configuration
   - Ensure cookies are properly set

3. **WebSocket connection failure**
   - Ensure session cookies are sent correctly
   - Check CORS configuration

4. **Redirect loops**
   - Check Authentik redirect URI configuration
   - Ensure it matches .env configuration

## Summary

By following these steps, you have successfully migrated Claude Code UI from local authentication to Authentik OIDC authentication. This provides:

- ✅ Enterprise-grade Single Sign-On (SSO)
- ✅ Standardized OAuth2/OIDC flow
- ✅ Better security and scalability
- ✅ Centralized user management

For issues, please refer to Authentik official documentation or submit an issue.