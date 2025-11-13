// Simple API integration tests using MSW
import React from 'react';
import { render, screen, fireEvent, waitFor } from '../utils/test-utils';
import { jest } from '@jest/globals';
import { server, http, getLastWebSocket } from '../mocks/simple-server.js';

// Simple test component that makes API calls
const SimpleApiComponent = () => {
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

  return (
    <div data-testid="simple-api-component">
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

      <button data-testid="load-projects-button" onClick={loadProjects}>
        Load Projects
      </button>

      <button data-testid="server-error-button" onClick={triggerServerError}>
        Trigger Server Error
      </button>
    </div>
  );
};

describe('Simple API Integration Tests with MSW', () => {
  test('successfully logs in user', async () => {
    render(<SimpleApiComponent />);

    const loginButton = screen.getByTestId('login-button');
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(screen.getByTestId('user-info')).toHaveTextContent('Logged in as: testuser');
    });

    expect(screen.getByTestId('loading-info')).toHaveTextContent('Not loading');
    expect(screen.getByTestId('error-info')).toHaveTextContent('No error');
  });

  test('loads projects successfully', async () => {
    render(<SimpleApiComponent />);

    const loadProjectsButton = screen.getByTestId('load-projects-button');
    fireEvent.click(loadProjectsButton);

    await waitFor(() => {
      expect(screen.getByTestId('projects-info')).toHaveTextContent('2 projects loaded');
    });

    expect(screen.getByTestId('loading-info')).toHaveTextContent('Not loading');
    expect(screen.getByTestId('error-info')).toHaveTextContent('No error');
  });

  test('handles server error correctly', async () => {
    render(<SimpleApiComponent />);

    const serverErrorButton = screen.getByTestId('server-error-button');
    fireEvent.click(serverErrorButton);

    await waitFor(() => {
      expect(screen.getByTestId('error-info')).toHaveTextContent('Internal server error');
    });

    expect(screen.getByTestId('loading-info')).toHaveTextContent('Not loading');
  });

  test('can override MSW handlers for specific tests', async () => {
    // Override the projects handler for this specific test
    server.use(
      http.get('/api/projects', () => {
        return Response.json({
          success: true,
          projects: [
            {
              id: 999,
              name: 'Special Test Project',
              path: '/special/path',
              description: 'A special test project',
              lastModified: new Date().toISOString()
            }
          ]
        });
      })
    );

    render(<SimpleApiComponent />);

    const loadProjectsButton = screen.getByTestId('load-projects-button');
    fireEvent.click(loadProjectsButton);

    await waitFor(() => {
      expect(screen.getByTestId('projects-info')).toHaveTextContent('1 projects loaded');
    });
  });
});