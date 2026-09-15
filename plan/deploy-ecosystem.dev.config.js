// Second cloudcli instance, serving this checkout, for trying changes against
// the live one without touching it.
//
//   cp plan/deploy-ecosystem.dev.config.js ~/.cloudcli/ecosystem.dev.config.js
//   npm run build            # dist/ is what gets served — rebuild before starting
//   ./plan/deploy-start-dev.sh
//
// Deliberately a SEPARATE file from ecosystem.config.js: `pm2 start` on a file
// acts on every app in it, and the live `cloudcli` app must never be restarted
// from here — it is the process hosting the Claude session doing the work.
module.exports = {
  apps: [{
    name: 'cloudcli-dev',
    script: 'dist-server/server/index.js',
    cwd: '/home/valeriu/work/claudecodeui',
    interpreter: '/home/valeriu/.nvm/versions/node/v24.14.0/bin/node',
    env: {
      // SERVER_PORT, not PORT: the PORT -> SERVER_PORT mapping lives in
      // cli.service.ts, and starting index.js directly skips it. PORT is set
      // too, only to overwrite the 40000 inherited from the live instance.
      SERVER_PORT: 40020,
      PORT: 40020,
      // The LAN interface specifically, not 0.0.0.0: v1's Caddy reaches this
      // host at 192.168.0.4 (that is how claudita.pirvu.ro gets to :40000), and
      // naming the interface keeps the three docker bridges out of it.
      // Public entry is https://claudita2.pirvu.ro, behind Authelia.
      HOST: '192.168.0.4',
      // A snapshot of the live database, never the live file. auth.db is not
      // auth-only — it holds sessions, projects, drafts and scheduled messages,
      // all written at runtime — and it runs in journal_mode=delete with no
      // WAL, so a writer locks the whole file. Sharing it would let this
      // instance stall the live one for up to better-sqlite3's 5s busy timeout.
      DATABASE_PATH: '/home/valeriu/.cloudcli/auth-dev.db',
      WORKSPACES_ROOT: '/home/valeriu/work',
      CONTEXT_WINDOW: 1000000,
      CLAUDE_CODE_ARTIFACT: 1,
      // Neutralises an inherited CLAUDE_CODE_CHILD_SESSION=1. The CLI checks
      // this one first and short-circuits the child-session branch, so sessions
      // started here still write their transcripts and stay resumable.
      CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: 1,
    },
    max_restarts: 10,
    restart_delay: 5000,
  }]
};
