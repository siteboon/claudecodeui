# Features

## System Chromium

Browser Use can use an existing Chromium installation. Set `CLOUDCLI_BROWSER_USE_CHROMIUM_PATH` to its absolute executable path in the CloudCLI server environment and restart CloudCLI. The host must already provide Chromium and its system dependencies. CloudCLI installs Playwright if needed, but skips browser downloads and OS dependency installation when the override is valid. Both temporary and persistent sessions use the configured executable. Without the override, installation and launch continue to use Playwright's managed runtime.
