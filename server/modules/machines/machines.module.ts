import { createWorkerConnectionRegistry } from '@/modules/worker-gateway/index.js';

import { createMachinesRouter } from './machines.routes.js';
import { createMachinesService } from './machines.service.js';

/**
 * Process-local machines service used by HTTP routes and worker authentication.
 */
export const machinesService = createMachinesService();

/**
 * Process-local worker socket registry. Lives beside machines because presence
 * and ping both need the same machinesService instance.
 */
export const workerConnectionRegistry = createWorkerConnectionRegistry({
  machinesService,
});

/**
 * Authenticated machines HTTP router mounted by the server entrypoint under
 * `/api/machines`.
 */
export const machinesRoutes = createMachinesRouter({
  machinesService,
  pingMachine: (machineId) => workerConnectionRegistry.pingMachine(machineId),
});

export { createMachinesService } from './machines.service.js';
export type { MachinesService } from './machines.service.js';
