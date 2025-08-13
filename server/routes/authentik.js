import express from 'express';
import config, { initializeOIDC } from '../config/authentik.js';

const router = express.Router();
let oidcClient = null;
let generators = null;

// Initialize OIDC client
(async () => {
  try {
    // Import generators from openid-client
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
    return res.status(503).json({ error: 'Authentication service not configured. Please configure Authentik.' });
  }
  
  // Generate state and nonce for security
  const state = generators.state();
  const nonce = generators.nonce();
  
  // Store in session
  req.session.state = state;
  req.session.nonce = nonce;
  
  // Generate authorization URL
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
    
    // Verify state
    if (params.state !== req.session.state) {
      throw new Error('State mismatch');
    }
    
    // Exchange code for tokens
    const tokenSet = await oidcClient.callback(config.redirectUri, params, {
      state: req.session.state,
      nonce: req.session.nonce,
    });
    
    // Get user info
    const userinfo = await oidcClient.userinfo(tokenSet);
    
    // Regenerate session to prevent session fixation attacks
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.redirect('/?error=session_error');
      }
      
      // Store user info in session
      req.session.user = {
        id: userinfo.sub,
        username: userinfo.preferred_username || userinfo.name || userinfo.email,
        email: userinfo.email,
        name: userinfo.name,
        groups: userinfo.groups || [],
      };
      
      req.session.tokenSet = tokenSet;
      
      // Save session before redirecting
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.redirect('/?error=session_error');
        }
        // Redirect to frontend
        res.redirect('/');
      });
    });
  } catch (error) {
    console.error('Authentication callback error:', error);
    res.redirect('/?error=auth_failed');
  }
});

// Get current user info
router.get('/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.json({ user: req.session.user });
});

// Logout
router.post('/logout', async (req, res) => {
  if (!oidcClient || !req.session.tokenSet) {
    req.session.destroy();
    return res.json({ success: true });
  }
  
  try {
    const tokenSet = req.session.tokenSet;
    
    // Revoke tokens if possible
    if (tokenSet.access_token) {
      await oidcClient.revoke(tokenSet.access_token, 'access_token');
    }
    
    // Get end session URL
    const endSessionUrl = oidcClient.endSessionUrl({
      id_token_hint: tokenSet.id_token,
      post_logout_redirect_uri: `${req.protocol}://${req.get('host')}/`,
    });
    
    // Destroy session
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