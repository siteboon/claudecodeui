export const CODEX_PERMISSION_MODE_ENV = 'CLOUDCLI_CODEX_PERMISSION_MODE';

const CODEX_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'bypassPermissions']);

function formatInvalidPermissionMode(value) {
  return JSON.stringify(String(value).trim());
}

function warnInvalidPermissionMode(logger, message) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(message);
  }
}

export function getConfiguredCodexPermissionMode(env = process.env, logger = console) {
  const configuredPermissionMode = env[CODEX_PERMISSION_MODE_ENV];
  if (configuredPermissionMode == null || String(configuredPermissionMode).trim() === '') {
    return 'default';
  }

  const normalizedPermissionMode = String(configuredPermissionMode).trim();
  if (CODEX_PERMISSION_MODES.has(normalizedPermissionMode)) {
    return normalizedPermissionMode;
  }

  warnInvalidPermissionMode(
    logger,
    `[Codex] Invalid ${CODEX_PERMISSION_MODE_ENV}=${formatInvalidPermissionMode(normalizedPermissionMode)}; falling back to default`,
  );
  return 'default';
}

export function resolveCodexPermissionMode(
  permissionMode,
  hasExplicitPermissionMode,
  { env = process.env, logger = console } = {},
) {
  if (!hasExplicitPermissionMode) {
    return getConfiguredCodexPermissionMode(env, logger);
  }

  const normalizedPermissionMode = String(permissionMode).trim();
  if (CODEX_PERMISSION_MODES.has(normalizedPermissionMode)) {
    return normalizedPermissionMode;
  }

  warnInvalidPermissionMode(
    logger,
    `[Codex] Invalid request permission mode=${formatInvalidPermissionMode(normalizedPermissionMode)}; falling back to default`,
  );
  return 'default';
}
