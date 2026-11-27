// createSystemModule: used by the server entrypoint to mount protected system update routes.
export { createSystemModule } from './system.module.js';
// readRunningApplicationVersion: used by the server entrypoint to capture its compiled build version.
export { readRunningApplicationVersion } from './running-version.service.js';
