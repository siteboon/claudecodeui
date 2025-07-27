# GitHub OAuth Setup Guide

This guide explains how to set up and test the GitHub OAuth integration for Claude Code UI.

## Prerequisites

1. A GitHub account
2. Access to create OAuth Apps in GitHub

## Setup Instructions

### 1. Create a GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in the application details:
   - **Application name**: Claude Code UI (or your preferred name)
   - **Homepage URL**: `http://localhost:3009`
   - **Authorization callback URL**: `http://localhost:3008/api/auth/github/callback`
4. Click "Register application"
5. Copy the Client ID and generate a new Client Secret

### 2. Configure Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

Update the `.env` file with your GitHub OAuth credentials:

```env
# Server ports
PORT=3008
VITE_PORT=3009

# GitHub OAuth configuration
GITHUB_CLIENT_ID=your_actual_client_id
GITHUB_CLIENT_SECRET=your_actual_client_secret
GITHUB_CALLBACK_URL=http://localhost:3008/api/auth/github/callback

# Allowed GitHub usernames (comma-separated)
GITHUB_ALLOWED_USERS=your-github-username,other-allowed-username

# Session secret (generate a random string)
SESSION_SECRET=your-random-session-secret-here
```

### 3. Clear Existing Database (if needed)

If you have an existing database, you may need to delete it to test the new schema:

```bash
rm server/database/auth.db
rm server/database/sessions.db
```

### 4. Start the Application

```bash
npm run dev
```

## Testing the OAuth Flow

### Test 1: Initial Setup with GitHub

1. Open http://localhost:3009
2. You should see the setup screen with a "Sign in with GitHub" button
3. Click the GitHub button
4. You'll be redirected to GitHub for authorization
5. After authorizing, you'll be redirected back and logged in

### Test 2: Allowed Users Only

1. Try logging in with a GitHub account that's in the `GITHUB_ALLOWED_USERS` list
   - Should succeed
2. Try logging in with a GitHub account that's NOT in the list
   - Should be rejected with an error message

### Test 3: Mixed Authentication

1. First, sign in with GitHub
2. Log out
3. Create a local account (if no users exist)
4. Verify both authentication methods work

### Test 4: Token Persistence

1. Log in with GitHub
2. Refresh the page
3. You should remain logged in
4. Check that the token is stored in localStorage

## Troubleshooting

### Common Issues

1. **"GitHub authentication required" error**
   - Ensure your GitHub OAuth app is properly configured
   - Check that environment variables are set correctly

2. **Redirect URI mismatch**
   - Make sure the callback URL in your GitHub app matches exactly: `http://localhost:3008/api/auth/github/callback`

3. **User not authorized**
   - Verify the GitHub username is in the `GITHUB_ALLOWED_USERS` environment variable
   - Usernames are case-sensitive

4. **Session errors**
   - Check that `SESSION_SECRET` is set in your environment
   - Ensure the `server/database` directory exists and is writable

### Debug Mode

To see more detailed logs:

1. Check server console for authentication logs
2. Check browser console for client-side errors
3. Monitor network tab for OAuth flow requests

## Security Considerations

1. **Never commit `.env` file** - It contains sensitive credentials
2. **Use HTTPS in production** - OAuth requires secure connections
3. **Restrict allowed users** - Only add trusted GitHub usernames
4. **Rotate secrets regularly** - Change CLIENT_SECRET and SESSION_SECRET periodically

## Production Deployment

For production deployment:

1. Update OAuth App URLs to your production domain
2. Set `NODE_ENV=production`
3. Use proper HTTPS certificates
4. Store secrets in environment variables, not in code
5. Consider using a proper session store (Redis, etc.) instead of SQLite