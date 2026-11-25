# Resident plugin mounts

*How a CloudCLI plugin gets to run before the user opens its tab — and why that
needed a host change.*

## The problem

Every plugin surface in CloudCLI is a workspace tab. `plugin-registry.service.ts`
accepts one `slot` (`ALLOWED_SLOTS = ['tab']`), and `PluginTabContent.tsx` mounts
a plugin bundle only while `activeTab === 'plugin:<name>'`. When the user moves
to another tab the bundle is unmounted, and until they come back its code is
not on the page at all — it is fetched from the API and imported from a blob URL
only at that moment.

That is the right default: a plugin should not cost anything while it is closed.
It does mean a plugin that wants to add something to the *shell* — a hover card
over the workspace list, a global shortcut, a badge in the header — cannot do it.
The user would have to open its tab first, and the effect would disappear again
as soon as they did anything else.

## The contract

A manifest opts in with one field:

```json
{
  "name": "my-plugin",
  "slot": "tab",
  "alwaysMount": true,
  "entry": "dist/index.js"
}
```

`alwaysMount` is optional and defaults to `false`. `validateManifest` rejects a
non-boolean value rather than guessing, because this field decides how much of
the UI a third-party bundle is attached to.

With it set, the host does two things:

1. `scanPlugins()` reports `alwaysMount: true` alongside the rest of the manifest,
   so the frontend can see it on the plugin object (`Plugin.alwaysMount`).
2. `PluginHostLayer` mounts the bundle once, as the app starts, for as long as
   the workspace is open — whatever tab is selected.

## How the resident mount works

`PluginHostLayer.tsx` is rendered by `WorkspacePluginLayer`, which
`ProjectWorkspaceShell` places next to the main region. It:

- keeps one zero-sized container per resident plugin, and
- calls the same `mount(container, host)` contract the tab surface uses.

The container is `position: fixed; width: 0; height: 0` so adding a plugin can
never shift the workspace layout. **It is not `display: none`**, which would also
hide anything a plugin positions inside it; and `pointer-events` is deliberately
left alone, since it would be inherited.

A resident plugin is expected to append its own DOM to `document.body` — the
container is a mount handle, not a place to render into.

The mount set is keyed by `name@entry`, so:

- a plugin being enabled or disabled re-mounts the set,
- an unrelated plugin-list refresh does not, and
- a project or session switch does not re-mount anything: it only pushes a new
  context through `onContextChange`.

## Telling the surfaces apart

Both surfaces publish the same context plus one discriminator:

```ts
host.context.surface; // 'tab' | 'resident'
```

The hover-card plugin uses it to render the card from the resident mount and the
settings panel from its tab. A bundle that supports only the tab surface can
ignore the field; one that supports only the resident surface simply renders
nothing in the tab.

Module scope is **not** shared between the two mounts — the host fetches and
imports the bundle separately for each — so anything they must agree on goes
through storage plus an event, not through a variable. The hover-card plugin
uses `localStorage` and a `window` event for exactly this reason.

## Addressing the shell

A resident plugin has no props and no React access, so the host publishes the
data it would otherwise have to scrape. Every workspace row — desktop layout and
compact layout alike — carries:

| Attribute | Value |
| --- | --- |
| `data-cloudcli-project-path` | The workspace's absolute path |
| `data-cloudcli-project-name` | The name the row displays |

A plugin attaches one delegated listener on `document` and matches with
`closest('[data-cloudcli-project-path]')`, which keeps working across re-renders
and for rows mounted after the plugin was.

## Security notes

The resident mount reuses the tab surface's loading path: the bundle is fetched
with the session's auth headers from `/api/plugins/<name>/assets/*` and imported
from a blob URL, so the browser never makes an unauthenticated request, and an
install still requires the same review the settings page warns about.

Because a resident plugin is attached to the shell for the whole session, it is
strictly more powerful than a tab plugin. `alwaysMount` is therefore opt-in per
manifest, surfaced in Settings → Plugins with a **resident** badge, and never
implied by another field.
