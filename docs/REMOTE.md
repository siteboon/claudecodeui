# Remote access (phone and other devices)

Workbench stays on your PC: terminals, worktrees and the CLIs all run there. Your phone or laptop only opens the Workbench web UI over a private [Tailscale](https://tailscale.com) network. Remote access is **off by default**.

## What is protected

- The server only accepts connections from this PC (loopback) and, when remote access is on, from Tailscale addresses (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`). Wi-Fi/LAN and internet connections are dropped at the TCP level before any web code runs.
- Sign-in is rate limited: 5 failed attempts per address (30 overall) in 15 minutes returns `429`.
- The first account can only be created on the PC itself, never remotely.
- Hermes/automation gets **no** terminal or git access (see "Not built yet").

Anyone who can sign in can run code on your PC through the terminals, so use a long, unique Workbench password and keep your Tailscale account protected with 2FA.

## Set up

1. Install Tailscale on the PC, the phone and any laptop, and sign in to the same Tailscale account (tailnet).
2. Start Workbench on the PC, create your account (on the PC), and set a long password.
3. In the tray menu choose **Remote access (Tailscale)** and confirm. Workbench restarts its server on the fixed port `3917` (or the next free port if that is taken).
4. Tray menu -> **Copy phone URL** gives `http://100.x.y.z:3917`. Open it on the phone (Tailscale must be connected) and sign in.
5. Windows may ask to allow Workbench through the firewall: allow it for **Private** networks. If connections from the phone hang, add an inbound rule for TCP 3917 restricted to the remote range `100.64.0.0/10`.

If the tray says "Tailscale not detected", start Tailscale on the PC.

## Notes

- Traffic over Tailscale is end-to-end encrypted, but the page itself is plain `http://`, so browsers treat it as an insecure context (some features such as notifications or clipboard may be limited). `tailscale serve` can put HTTPS in front of port 3917 if you need that.
- Turning remote access off restarts the server on a random loopback-only port again.
- Settings live in `%APPDATA%\Workbench\workbench-settings.json` (macOS: `~/Library/Application Support/Workbench`), per machine.
- To run without the desktop app: `WORKBENCH_REMOTE=1 SERVER_PORT=3917 npm run server:dev`.

## Not built yet

- A phone-friendly layout of the session list, status and prompt box (the existing mobile layout is used as is).
- Creating sessions from the phone works through the same UI/API as on the PC, but has not been tried on a phone.
- The one-way Hermes feed (read-only session status and usage) and "proposed tasks" that need your approval before anything runs.
- Tailscale itself is not installed on the development PC, so the Tailscale path has not been tested end to end; loopback allowed, LAN dropped and the throttle were tested.
