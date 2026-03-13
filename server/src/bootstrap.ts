import { createServerApplication } from '@/app.js';

async function startServerApplication(): Promise<void> {
  const application = createServerApplication();
  await application.start();
}

await startServerApplication();
