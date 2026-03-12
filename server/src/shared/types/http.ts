import type { Request } from 'express';

export type TransportKind = 'http' | 'sse' | 'ws';

/**
 * Meta information about an API response, such as request ID and timing details.
 * Different from RequestContext which is the internal server-side context for an 
 * incoming request.
 */
export type ApiMeta = {
  requestId?: string;
  startedAt?: string;
};

export type ApiSuccessShape<TData = unknown> = {
  success: true;
  data: TData;
  meta?: ApiMeta;
};

export type ApiErrorShape = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: ApiMeta;
};

/**
 * Internal server-side context for an incoming request.
 * It's the source object. It's different from ApiMeta which is 
 * meant for API responses.
 */
export type RequestContext = {
  requestId: string;
  startedAt: string;
};

export type AuthenticatedUser = {
  id: number | string;
  username?: string;
  [key: string]: unknown;
};

export type AuthenticatedRequest = Request & {
  context?: RequestContext;
  user?: AuthenticatedUser;
};

export type EndpointInventoryRecord = {
  transport: TransportKind;
  method: string;
  path: string;
  tag: string;
  authMode: string;
  sourceFile: string;
  sourceLine: number;
  purpose: string;
  consumerFiles: string[];
  inputs: {
    pathParams: string[];
    queryParams: string[];
    bodyHints: string[];
  };
  successShape: string;
  errorShape: string;
  sideEffects: string[];
  priority: 'high' | 'medium' | 'low';
};
