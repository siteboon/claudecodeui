// API integration tests using MSW
import React from 'react';
import { render, screen, fireEvent, waitFor } from '../utils/test-utils';
import { jest } from '@jest/globals';
import { server, rest, createMockWebSocket, getLastWebSocket } from '../mocks/server.js';

// Test component that makes API calls
const ApiTestComponent = () => {
  const [user, setUser] = React.useState(null);
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'testuser',
          password: 'password123'
        })
      });
      const data = await response.json();
      if (data.success) {
        setUser(data.user);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginFailure = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'wronguser',
          password: 'wrongpassword'
        })
      });
      const data = await response.json();
      if (data.success) {
        setUser(data.user);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      if (data.success) {
        setProjects(data.projects);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const triggerNetworkError = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/error/network');
      const data = await response.json();
      // This shouldn't execute due to network error
    } catch (err) {
      setError('Network error triggered');
    } finally {
      setLoading(false);
    }
  };

  const triggerServerError = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/error/500');
      const data = await response.json();
      if (data.success) {
        setUser(data.user);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Request failed');
    } finally {
      setLoading(false);
    }
  };

  const connectWebSocket = () => {
    const ws = new WebSocket('ws://localhost:3001/ws');

    ws.addEventListener('open', () => {
      console.log('WebSocket connected');
    });

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);
    });

    return ws;
  };

  return (
    <div data-testid="api-test-component">
      <div data-testid="user-info">
        {user ? `Logged in as: ${user.username}` : 'Not logged in'}
      </div>

      <div data-testid="projects-info">
        {projects.length > 0 ? `${projects.length} projects loaded` : 'No projects loaded'}
      </div>

      <div data-testid="loading-info">
        {loading ? 'Loading...' : 'Not loading'}
      </div>

      <div data-testid="error-info">
        {error || 'No error'}
      </div>

      <button data-testid="login-button" onClick={handleLogin}>
        Login
      </button>

      <button data-testid="login-fail-button" onClick={handleLoginFailure}>
        Login (Should Fail)
      </button>

      <button data-testid="load-projects-button" onClick={loadProjects}>
        Load Projects
      </button>

      <button data-testid="network-error-button" onClick={triggerNetworkError}>
        Trigger Network Error
      </button>

      <button data-testid="server-error-button" onClick={triggerServerError}>
        Trigger Server Error
      </button>

      <button data-testid="websocket-button" onClick={connectWebSocket}>
        Connect WebSocket
      </button>
    </div>
  );
};

describe('API Integration Tests with MSW', () => {
  beforeEach(() => {
    // Clear any existing WebSocket instances
    global.WebSocket.mockClear();
  });

  test('successfully logs in user', async () => {
    render(<ApiTestComponent />);

    const loginButton = screen.getByTestId('login-button');
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(screen.getByTestId('user-info')).toHaveTextContent('Logged in as: testuser');
    });

    expect(screen.getByTestId('loading-info')).toHaveTextContent('Not loading');
    expect(screen.getByTestId('error-info')).toHaveTextContent('No error');
  });

  test('handles login failure correctly', async () => {
    render(<ApiTestComponent />);

    const loginFailButton = screen.getByTestId('login-fail-button');
    fireEvent.click(loginFailButton);

    await waitFor(() => {
      expect(screen.getByTestId('error-info')).toHaveTextContent('Invalid credentials');
    });

    expect(screen.getByTestId('user-info')).toHaveTextContent('Not logged in');
    expect(screen.getByTestId('loading-info')).toHaveTextContent('Not loading');
  });

  test('loads projects successfully', async () => {
    render(<ApiTestComponent />);

    const loadProjectsButton = screen.getByTestId('load-projects-button');
    fireEvent.click(loadProjectsButton);

    await waitFor(() => {
      expect(screen.getByTestId('projects-info')).toHaveTextContent('2 projects loaded');
    });

    expect(screen.getByTestId('loading-info')).toHaveTextContent('Not loading');
    expect(screen.getByTestId('error-info')).toHaveTextContent('No error');
  });

  test('handles network error gracefully', async () => {
    render(<ApiTestComponent />);

    const networkErrorButton = screen.getByTestId('network-error-button');
    fireEvent.click(networkErrorButton);

    await waitFor(() => {
      expect(screen.getByTestId('error-info')).toHaveTextContent('Network error triggered');
    });

    expect(screen.getByTestId('loading-info')).toHaveTextContent('Not loading');
  });

  test('handles server error correctly', async () => {
    render(<ApiTestComponent />);

    const serverErrorButton = screen.getByTestId('server-error-button');
    fireEvent.click(serverErrorButton);

    await waitFor(() => {
      expect(screen.getByTestId('error-info')).toHaveTextContent('Internal server error');
    });

    expect(screen.getByTestId('loading-info')).toHaveTextContent('Not loading');
  });

  test('creates WebSocket connection', () => {
    render(<ApiTestComponent />);

    const webSocketButton = screen.getByTestId('websocket-button');
    fireEvent.click(webSocketButton);

    expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:3001/ws');
  });

  test('WebSocket has correct methods', () => {
    render(<ApiTestComponent />);

    const webSocketButton = screen.getByTestId('websocket-button');
    fireEvent.click(webSocketButton);

    const ws = getLastWebSocket();
    expect(ws).toBeDefined();
    expect(typeof ws.send).toBe('function');
    expect(typeof ws.close).toBe('function');
    expect(typeof ws.addEventListener).toBe('function');
  });

  test('can override MSW handlers for specific tests', async () => {
    // Override the login handler for this specific test
    server.use(
      rest.post('/api/auth/login', (req, res, ctx) => {
        return res(
          ctx.status(200),
          ctx.json({
            success: true,
            user: { id: 999, username: 'special-user', email: 'special@example.com' },
            token: 'special-token'
          })
        );
      })
    );

    render(<ApiTestComponent />);

    const loginButton = screen.getByTestId('login-button');
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(screen.getByTestId('user-info')).toHaveTextContent('Logged in as: special-user');
    });
  });

  test('can simulate 404 errors', async () => {
    server.use(
      rest.get('/api/projects', (req, res, ctx) => {
        return res(
          ctx.status(404),
          ctx.json({
            success: false,
            error: 'Projects endpoint not found'
          })
        );
      })
    );

    render(<ApiTestComponent />);

    const loadProjectsButton = screen.getByTestId('load-projects-button');
    fireEvent.click(loadProjectsButton);

    await waitFor(() => {
      expect(screen.getByTestId('error-info')).toHaveTextContent('Projects endpoint not found');
    });
  });

  test('can simulate delayed responses', async () => {
    server.use(
      rest.post('/api/auth/login', (req, res, ctx) => {
        return res(
          ctx.delay(100), // 100ms delay
          ctx.status(200),
          ctx.json({
            success: true,
            user: { id: 1, username: 'testuser', email: 'test@example.com' },
            token: 'mock-jwt-token'
          })
        );
      })
    );

    render(<ApiTestComponent />);

    const loginButton = screen.getByTestId('login-button');
    fireEvent.click(loginButton);

    // Should show loading state during delay
    expect(screen.getByTestId('loading-info')).toHaveTextContent('Loading...');

    await waitFor(() => {
      expect(screen.getByTestId('user-info')).toHaveTextContent('Logged in as: testuser');
    }, { timeout: 200 });
  });

  test('WebSocket can simulate messages', () => {
    render(<ApiTestComponent />);

    const webSocketButton = screen.getByTestId('websocket-button');
    fireEvent.click(webSocketButton);

    const ws = getLastWebSocket();
    const mockConsole = jest.spyOn(console, 'log').mockImplementation();

    // Simulate receiving a message
    ws.simulateMessage({
      type: 'response',
      data: { content: 'Hello from WebSocket!' }
    });

    // Verify the message handler was called
    expect(ws.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

    mockConsole.mockRestore();
  });
});