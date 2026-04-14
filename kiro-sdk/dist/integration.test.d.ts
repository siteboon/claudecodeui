/**
 * Integration tests — spawns a real kiro-cli acp process.
 *
 * Run with: npm run test:integration
 * Requires kiro-cli to be installed and authenticated.
 *
 * NOTE: As of kiro-cli 1.29.3, `session/prompt` causes the ACP process to exit
 * with code 0 (no error). The initialize and session/new methods work correctly.
 * Prompt streaming tests are skipped until this is resolved in kiro-cli.
 */
export {};
