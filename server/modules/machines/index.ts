// machinesRoutes / machinesService / workerConnectionRegistry: composed here so
// the server entrypoint and websocket gateway share one process-local instance.
export {
  machinesRoutes,
  machinesService,
  workerConnectionRegistry,
  createMachinesService,
} from './machines.module.js';
export type { MachinesService } from './machines.module.js';
