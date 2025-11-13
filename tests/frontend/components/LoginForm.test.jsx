// LoginForm component tests
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginForm from '../../../src/components/LoginForm';

// Mock the AuthContext
jest.mock('../../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: jest.fn()
  })
}));

describe('LoginForm Component', () => {
  let mockLogin;

  beforeEach(() => {
    mockLogin = require('../../../src/contexts/AuthContext').useAuth().login;
    mockLogin.mockClear();
  });

  test('renders login form with all elements', () => {
    render(<LoginForm />);

    // Check for main title
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();

    // Check for form inputs
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();

    // Check for submit button
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();

    // Check for logo/message
    expect(screen.getByText(/sign in to your claude code ui account/i)).toBeInTheDocument();
  });

  test('allows user to enter username and password', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'password123');

    expect(usernameInput).toHaveValue('testuser');
    expect(passwordInput).toHaveValue('password123');
  });

  test('shows validation error when form is submitted with empty fields', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    await user.click(submitButton);

    expect(screen.getByText(/please enter both username and password/i)).toBeInTheDocument();
  });

  test('shows validation error when username is empty', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    expect(screen.getByText(/please enter both username and password/i)).toBeInTheDocument();
  });

  test('shows validation error when password is empty', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const usernameInput = screen.getByLabelText(/username/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'testuser');
    await user.click(submitButton);

    expect(screen.getByText(/please enter both username and password/i)).toBeInTheDocument();
  });

  test('calls login function with correct credentials', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ success: true });

    render(<LoginForm />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
  });

  test('shows loading state during login attempt', async () => {
    const user = userEvent.setup();
    mockLogin.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

    render(<LoginForm />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    // Check loading state
    expect(screen.getByRole('button', { name: /signing in\.\.\./i })).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByLabelText(/username/i)).toBeDisabled();
    expect(screen.getByLabelText(/password/i)).toBeDisabled();
  });

  test('displays error message when login fails', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ success: false, error: 'Invalid credentials' });

    render(<LoginForm />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'wrongpassword');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });

    // Check that loading state is removed
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  test('clears error message when user starts typing', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ success: false, error: 'Invalid credentials' });

    render(<LoginForm />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    // First trigger an error
    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'wrongpassword');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });

    // Start typing again
    await user.clear(usernameInput);
    await user.type(usernameInput, 'newuser');

    // Error should be cleared
    await waitFor(() => {
      expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
    });
  });

  test('form inputs have correct attributes', () => {
    render(<LoginForm />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);

    // Check input types
    expect(usernameInput).toHaveAttribute('type', 'text');
    expect(passwordInput).toHaveAttribute('type', 'password');

    // Check required attribute
    expect(usernameInput).toBeRequired();
    expect(passwordInput).toBeRequired();

    // Check placeholder text
    expect(usernameInput).toHaveAttribute('placeholder', 'Enter your username');
    expect(passwordInput).toHaveAttribute('placeholder', 'Enter your password');
  });

  test('disables inputs during loading state', async () => {
    const user = userEvent.setup();
    mockLogin.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

    render(<LoginForm />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    // Check that inputs are disabled during loading
    expect(usernameInput).toBeDisabled();
    expect(passwordInput).toBeDisabled();
    expect(submitButton).toBeDisabled();
  });
});