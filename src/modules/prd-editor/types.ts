import type { ExistingPrdFile } from '@/shared/types';



export type PrdListResponse = {
  prdFiles?: ExistingPrdFile[];
  prds?: ExistingPrdFile[];
};

export type SavePrdInput = {
  content: string;
  fileName: string;
  allowOverwrite?: boolean;
};

export type SavePrdResult =
  | { status: 'saved'; fileName: string }
  | { status: 'needs-overwrite'; fileName: string }
  | { status: 'failed'; message: string };
