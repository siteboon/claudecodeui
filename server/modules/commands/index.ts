// commandsRoutes: used by the server entrypoint to mount protected slash-command endpoints.
export { commandsRoutes } from './commands.module.js';

// Runtime capture of the CLI-native command catalogues: providers record
// what their live CLIs report, the routes serve it back per provider.
export { getNativeCommands, recordNativeCommands } from './native-commands.js';
