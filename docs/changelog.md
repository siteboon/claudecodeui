# Manual Changelog

## 1.37.7

### 2026-11-04

- Fix immediate Claude Chat exit with code 1 when root enables Bypass Permissions or Skip Permissions. Use default SDK permissions with automatic approval for ordinary tool requests rather than native bypass or dontAsk. Preserve interactive requests, plan-mode precedence, and non-root behavior.
- Reproduce the root failure with Claude Code 2.1.317 and Agent SDK 0.3.165. Add source-based runtime regression tests for both bypass entry points and approval behavior.
