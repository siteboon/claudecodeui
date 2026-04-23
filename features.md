# Features

## Authentication

- Claude provider status detection treats `ANTHROPIC_AUTH_TOKEN` from the running process environment as a valid authenticated state.
- The Claude auth regression check is exposed as `npm run test:provider-auth`, which rebuilds the server artifact before executing the test.
