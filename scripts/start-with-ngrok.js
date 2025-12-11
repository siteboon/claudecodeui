#!/usr/bin/env node

import ngrok from "ngrok";
import { spawn } from "child_process";

let shuttingDown = false;

async function cleanup(devProcess) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\nShutting down...");
  try {
    await ngrok.disconnect();
    await ngrok.kill();
  } catch (e) {}

  if (devProcess) {
    devProcess.kill();
  }
  process.exit(0);
}

async function startWithNgrok() {
  console.log("Starting frontend server...");

  let detectedPort = null;

  const devProcess = spawn("npm", ["run", "dev"], {
    shell: true,
  });

  process.on("SIGINT", () => cleanup(devProcess));
  process.on("SIGTERM", () => cleanup(devProcess));

  devProcess.stdout.on("data", (data) => {
    const output = data.toString();
    process.stdout.write(output);

    const portMatch = output.match(/Local:\s+http:\/\/localhost:(\d+)/);
    if (portMatch && !detectedPort) {
      detectedPort = parseInt(portMatch[1], 10);
      console.log(`\n✓ Detected Vite running on port ${detectedPort}`);
      startNgrokTunnel(3002, devProcess);
    }
  });

  devProcess.stderr.on("data", (data) => {
    process.stderr.write(data);
  });

  devProcess.on("close", (code) => {
    console.log(`Dev process exited with code ${code}`);
    cleanup(null);
  });

  setTimeout(() => {
    if (!detectedPort) {
      console.error("\n❌ Failed to detect Vite port after 15 seconds");
      cleanup(devProcess);
    }
  }, 15000);
}

async function startNgrokTunnel(port, devProcess) {
  console.log(`\nConnecting ngrok to port ${port}...`);

  try {
    try {
      await ngrok.kill();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (e) {}
    console.log("Starting ngrok at port:" + port);
    const url = await ngrok.connect({
      addr: port,
      onStatusChange: (status) => {
        if (status === "closed" && !shuttingDown) {
          console.log("Ngrok connection lost, attempting reconnect...");
        }
      },
      onLogEvent: (data) => {
        if (data && data.msg && !data.msg.includes("no configuration")) {
          console.log("Ngrok:", data.msg);
        }
      },
    });

    console.log("\n===========================================");
    console.log("🚀 Frontend is now accessible from outside!");
    console.log("===========================================");
    console.log(`Local URL:  http://localhost:${port}`);
    console.log(`Public URL: ${url}`);
    console.log("===========================================\n");
  } catch (error) {
    console.error("\n❌ Failed to start ngrok:", error.message);

    if (error.message.includes("failed to start tunnel")) {
      console.log("Error", error);
      console.error("\n📝 This usually means ngrok needs authentication.");
      console.error(
        "   1. Sign up at https://ngrok.com and get your authtoken",
      );
      console.error("   2. Run: \x1b[33mnpx ngrok authtoken YOUR_TOKEN\x1b[0m");
      console.error("   3. Then run: \x1b[33mnpm run start:ngrok\x1b[0m\n");
    } else if (error.message.includes("invalid tunnel configuration")) {
      console.error(
        '\n📝 If you see "invalid tunnel configuration", this is a known issue.',
      );
      console.error("   Workaround: Run this command in a separate terminal:");
      console.error(
        "   \x1b[33mpkill -9 ngrok && npm run start:ngrok\x1b[0m\n",
      );
    }

    cleanup(devProcess);
  }
}

startWithNgrok();
