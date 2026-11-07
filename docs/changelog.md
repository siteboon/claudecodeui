# Changelog

## 1.37.3

### 2026-10-12

- Move manual records from root `changelog.md` to `docs/changelog.md` to avoid case-insensitive collisions with release-generated `CHANGELOG.md`. Update documentation links and record the maintenance convention in AGENTS.md. Runtime behavior is unchanged.

### 2026-10-09

- Discover Codex Chat models and reasoning efforts dynamically through the existing CLI, with pagination, a one-minute memory cache, visible-page refresh, and fallback when discovery fails.
- Add source-based protocol, cache, fallback, and frontend refresh tests. See [features](../features.md) and the main [changelog](../CHANGELOG.md).
