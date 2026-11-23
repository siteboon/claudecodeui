# Features

## Browser Live Control

In the Browser tab, select a running agent-owned Chromium session and choose **Take control**. The live view accepts clicks, typing, paste, wheel scrolling, and drag gestures on the current web page. A drag is sent when the pointer is released. This is an in-app browser viewer, not a Linux desktop or a native browser window.

Only one viewer can control a session. While the user is in control, CloudCLI's browser tools cannot inspect, modify, or stop the page. Closing the viewer or losing the connection does not close the browser or resume the agent. After 15 seconds without frames, an authenticated viewer can reclaim control; choose **Return to agent** when the page is safe to share again. The ordinary browser session idle timeout still applies.

The viewer uses the existing Browser Use runtime and authenticated API. No VNC service, new port, or runtime configuration is required. Oversized pastes are rejected rather than partially inserted; already queued input finishes before control returns.
