import { WebSocketServer } from 'ws';

export type RuntimePaths = {
  serverSrcDir: string;
  serverDir: string;
  projectRoot: string;
  legacyRuntimePath: string;
  bootstrapEntrypointPath: string;
};

export type AppLocals = {
  requestId?: string;
  wss?: WebSocketServer;
};

export type ServerApplication = {
  runtimePaths: RuntimePaths;
  start: () => Promise<void>;
};
