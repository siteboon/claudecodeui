// The HTTP surface for scheduling a message to a session, mounted by the app.
export { default as scheduledMessagesRoutes } from './scheduled-messages.routes.js';
// Messages queued behind a running turn, sent by the same dispatcher.
export { default as queuedMessagesRoutes } from './queued-messages.routes.js';

// The timer that sends them, started and stopped with the server.
export {
  initializeScheduledMessageDispatcher,
  closeScheduledMessageDispatcher,
} from './services/scheduled-message-dispatcher.service.js';
