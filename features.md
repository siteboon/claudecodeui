# Features

## Claude Root Bypass Approval

Claude Chat uses the SDK default permission mode and its approval callback when root selects Bypass Permissions or Skip Permissions. This prevents the immediate exit caused by Claude Code rejecting native bypass mode as root. Ordinary tool requests reaching the callback are approved automatically, while AskUserQuestion and ExitPlanMode remain interactive. Claude Code policies and explicit deny rules still apply; this is not an OS security bypass or the `auto` classifier.

Plan mode retains precedence over Skip Permissions. Non-root runs retain native bypass mode. Regression tests exercise the real runtime option mapping and approval callback through the SDK query seam without invoking a model or resuming a user session.
