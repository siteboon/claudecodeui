export type PrdFile = {
  name?: string;
  path?: string;
  projectName?: string;
  content?: string;
  isExisting?: boolean;
};

export type ExistingPrdFile = {
  name: string;
  content?: string;
  isExisting?: boolean;
  [key: string]: unknown;
};

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
