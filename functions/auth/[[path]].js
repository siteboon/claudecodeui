export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/auth/', '');
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Route Auth requests
    switch (path) {
      case 'status':
        return handleAuthStatus(request, corsHeaders);
      case 'login':
        return handleLogin(request, corsHeaders);
      case 'register':
        return handleRegister(request, corsHeaders);
      case 'logout':
        return handleLogout(request, corsHeaders);
      case 'user':
        return handleUserInfo(request, corsHeaders);
      case 'refresh':
        return handleTokenRefresh(request, corsHeaders);
      case 'verify':
        return handleTokenVerify(request, corsHeaders);
      default:
        return new Response(JSON.stringify({ error: 'Auth endpoint not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Mock user database (in real app, this would be a real database)
const mockUsers = [
  {
    id: 1,
    username: 'demo',
    email: 'demo@example.com',
    password: 'demo', // In real app, this would be hashed
    role: 'user',
    createdAt: '2024-01-01T00:00:00Z',
    lastLogin: '2024-01-01T00:00:00Z'
  },
  {
    id: 2,
    username: 'admin',
    email: 'admin@example.com',
    password: 'admin',
    role: 'admin',
    createdAt: '2024-01-01T00:00:00Z',
    lastLogin: '2024-01-01T00:00:00Z'
  }
];

// Mock tokens storage (in real app, this would be Redis or similar)
const mockTokens = new Map();

// Generate mock JWT token
function generateMockToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
  };
  
  // In real app, this would be signed with a secret key
  const token = `mock-jwt-${btoa(JSON.stringify(payload))}`;
  mockTokens.set(token, { user, expiresAt: payload.exp * 1000 });
  
  return token;
}

// Verify mock JWT token
function verifyMockToken(token) {
  if (!token || !token.startsWith('mock-jwt-')) {
    return null;
  }
  
  const stored = mockTokens.get(token);
  if (!stored || Date.now() > stored.expiresAt) {
    mockTokens.delete(token);
    return null;
  }
  
  return stored.user;
}

// Auth Status
async function handleAuthStatus(request, corsHeaders) {
  const authHeader = request.headers.get('Authorization');
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const user = verifyMockToken(token);
    
    if (user) {
      return new Response(JSON.stringify({ 
        authenticated: true, 
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
  
  return new Response(JSON.stringify({ 
    authenticated: false, 
    user: null 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Login
async function handleLogin(request, corsHeaders) {
  if (request.method === 'POST') {
    const { username, password } = await request.json();
    
    // Find user
    const user = mockUsers.find(u => 
      (u.username === username || u.email === username) && u.password === password
    );
    
    if (user) {
      // Generate token
      const token = generateMockToken(user);
      
      // Update last login
      user.lastLogin = new Date().toISOString();
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Invalid username or password' 
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Register
async function handleRegister(request, corsHeaders) {
  if (request.method === 'POST') {
    const { username, email, password, confirmPassword } = await request.json();
    
    // Validation
    if (!username || !email || !password) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'All fields are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (password !== confirmPassword) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Passwords do not match' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (password.length < 6) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Password must be at least 6 characters long' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Check if user already exists
    const existingUser = mockUsers.find(u => 
      u.username === username || u.email === email
    );
    
    if (existingUser) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Username or email already exists' 
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Create new user
    const newUser = {
      id: mockUsers.length + 1,
      username,
      email,
      password, // In real app, this would be hashed
      role: 'user',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    mockUsers.push(newUser);
    
    // Generate token
    const token = generateMockToken(newUser);
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'User registered successfully',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Logout
async function handleLogout(request, corsHeaders) {
  if (request.method === 'POST') {
    const authHeader = request.headers.get('Authorization');
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      mockTokens.delete(token);
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Logged out successfully' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// User Info
async function handleUserInfo(request, corsHeaders) {
  const authHeader = request.headers.get('Authorization');
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const user = verifyMockToken(token);
    
    if (user) {
      return new Response(JSON.stringify({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
  
  return new Response(JSON.stringify({ 
    success: false, 
    error: 'Unauthorized' 
  }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Token Refresh
async function handleTokenRefresh(request, corsHeaders) {
  if (request.method === 'POST') {
    const { refreshToken } = await request.json();
    
    // In real app, this would validate a refresh token
    // For demo purposes, we'll just return a new token
    const newToken = `mock-jwt-refreshed-${Date.now()}`;
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Token refreshed successfully',
      token: newToken
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// Token Verify
async function handleTokenVerify(request, corsHeaders) {
  if (request.method === 'POST') {
    const { token } = await request.json();
    
    const user = verifyMockToken(token);
    
    if (user) {
      return new Response(JSON.stringify({ 
        success: true, 
        valid: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      valid: false,
      error: 'Invalid or expired token'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}