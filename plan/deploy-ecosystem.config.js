// Drop-in replacement for ~/.cloudcli/ecosystem.config.js
//
//   cp plan/deploy-ecosystem.config.js ~/.cloudcli/ecosystem.config.js
//
module.exports = {
  apps: [{
    name: 'cloudcli',
    script: '/home/valeriu/.nvm/versions/node/v24.14.0/bin/cloudcli',
    interpreter: '/home/valeriu/.nvm/versions/node/v24.14.0/bin/node',
    env: {
      PORT: 40000,
      WORKSPACES_ROOT: '/home/valeriu/work',
      // cloudcli draws its context bar from this; it never asks Claude for the real
      // window. Display-only, but it reads 160000 without it.
      CONTEXT_WINDOW: 1000000,
      // cloudcli spawns claude with CLAUDE_CODE_ENTRYPOINT=sdk-ts, and the Artifact tool
      // is off by default on SDK entrypoints. Opt back in.
      CLAUDE_CODE_ARTIFACT: 1,
      // ~/.pm2/dump.pm2 froze CLAUDE_CODE_CHILD_SESSION=1 into this app's environment
      // (a `pm2 save` run from inside a Claude session on 2026-08-25), and pm2
      // resurrect replays it at every boot. Inherited by the PTY, it makes every
      // `claude` started from the Shell tab believe it is a child session and skip
      // writing its transcript — so those sessions cannot be resumed and never
      // appear in history.
      //
      // pm2 cannot unset a variable from here, but the CLI checks this one first
      // and short-circuits the whole child-session branch, so setting it suffices:
      //   if (env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE) return false;   // <- wins
      //   if (!(env.CLAUDE_CODE_CHILD_SESSION && ...)) return false;
      //
      // Reload with safe-restart.sh — a plain `pm2 restart cloudcli` replays the
      // saved environment and never re-reads this file.
      CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: 1,
    },
    max_restarts: 10,
    restart_delay: 5000,
  }]
};
