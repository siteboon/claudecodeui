# Hermes Gateway Controls

CloudCLI can manage the Hermes Gateway process from **Settings -> Agents -> Hermes -> Gateway**.

The gateway is optional. Normal CloudCLI chat and automation should continue to use `POST /api/agent` with `provider: "hermes"`. The gateway is for long-running Hermes integrations such as Telegram, Discord, WhatsApp, and other messaging surfaces configured by Hermes.

## What The Gateway Tab Does

- Shows whether Hermes is installed and whether the gateway is running.
- Starts Hermes with `hermes gateway run` in the current CloudCLI server environment.
- Stops or restarts a gateway process started by CloudCLI.
- Opens `hermes gateway setup` in the terminal for platform configuration.
- Shows detected Hermes profiles for visibility.
- Shows recent logs from the gateway process managed by CloudCLI.

## What It Does Not Do

- It does not expose the Hermes HTTP gateway as a raw public API.
- It does not add a new authentication model.
- It does not replace the CloudCLI Agent API.
- It does not create Docker containers or require Docker.

## API Boundaries

CloudCLI has two separate surfaces:

- **CloudCLI Agent API**: `POST /api/agent`
  Use this for programmatic CloudCLI tasks, including Hermes tasks. It supports `projectPath`, `githubUrl`, sessions, branches, and other CloudCLI workflow options.

- **Hermes Gateway controls**: `/api/providers/hermes/gateway/*`
  These are browser-authenticated UI control endpoints used by the settings page.

The gateway controls intentionally stay inside the authenticated provider API. They are not a customer-facing replacement for `POST /api/agent`.

## Hosted Environments

In hosted or containerized environments, CloudCLI runs the gateway in foreground mode because system service managers such as systemd or launchd may not be available. This matches Hermes' recommended foreground mode for containers and similar runtimes.

If Docker is not available, the Gateway tab still works for the local Hermes process. Docker is only relevant for advanced deployments where a user chooses to run Hermes separately.

## References

- [Hermes Agent releases](https://github.com/NousResearch/hermes-agent/releases) for current gateway and messaging platform capabilities.
- [Hermes hooks documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks) for non-interactive gateway runs and hook approval behavior.
- [Hermes environment variables](https://hermes-agent.nousresearch.com/docs/reference/environment-variables) for Docker-image-specific gateway supervision details.
