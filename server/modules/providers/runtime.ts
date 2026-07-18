// Stateful SDK/CLI execution is a separate entrypoint from the lower-level
// provider facets. This prevents consumers of `providers/index.ts` from loading
// every runtime adapter and creating cycles through session/project services.
export { providerRuntimeService } from './services/provider-runtime.service.js';
