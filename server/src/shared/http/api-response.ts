import type {
  ApiErrorShape,
  ApiMeta,
  ApiSuccessShape,
} from '@/shared/types/http.js';

export function createApiMeta(requestId?: string, startedAt?: string): ApiMeta {
  return {
    requestId,
    startedAt,
  };
}

export function createApiSuccessResponse<TData>(
  data: TData,
  meta?: ApiMeta
): ApiSuccessShape<TData> {
  return {
    success: true,
    data,
    meta,
  };
}

export function createApiErrorResponse(
  code: string,
  message: string,
  meta?: ApiMeta,
  details?: unknown
): ApiErrorShape {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta,
  };
}
