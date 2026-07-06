# Artifact Preview

Agents and skills can present mockups by writing preview files inside the project and linking them in normal Markdown.

Default location:

```text
tmp/cloudcli-artifacts/<session>/
```

Supported v1 files:

- self-contained `.html` files with inline CSS and JavaScript
- image screenshots: `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`, `.gif`

Example:

```md
[Open mockup](tmp/cloudcli-artifacts/sidebar/overview.html)
[Screenshot](tmp/cloudcli-artifacts/sidebar/overview.png)
```

CloudCLI previews these links inside the authenticated UI. HTML runs in a sandboxed iframe and cannot access CloudCLI origin state.

V1 does not support public sharing, localhost servers, automatic screenshots, click telemetry, or multi-file HTML bundles.
