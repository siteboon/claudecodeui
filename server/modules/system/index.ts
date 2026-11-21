// createSystemModule: used by the server entrypoint to mount protected system update routes.
export { createSystemModule } from './system.module.js';
// recordServerStart: used by the server entrypoint once it binds its port, for `cloudcli status`.
// createCliUpdateWorkflow: used by the CLI module so `cloudcli update` and `cloudcli status` share
// the web updater's install check and update records.
export { createCliUpdateWorkflow, recordServerStart } from './system.module.js';
