// createSystemModule: used by the server entrypoint to mount protected system update and keep-awake routes.
export { createSystemModule } from './system.module.js';
// keepAwakeService: used by the providers module to hold the computer awake during runs, and by the
// server entrypoint to load the saved setting at startup and release the hold on shutdown.
export { keepAwakeService } from './system.module.js';
