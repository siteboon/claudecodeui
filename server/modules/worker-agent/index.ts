import { createWorkerAgentService } from './worker-agent.service.js';

/**
 * Creates the production worker-agent service for the CLI `worker` command.
 */
export function createWorkerAgentApplication() {
  return createWorkerAgentService({
    environment: process.env,
    output: {
      log: (message = '') => console.log(message),
      error: (message = '') => console.error(message),
    },
  });
}

export { createWorkerAgentService } from './worker-agent.service.js';
export type { WorkerAgentService } from './worker-agent.service.js';
