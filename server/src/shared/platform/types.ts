// This type keeps the rest of the backend independent from Node's raw platform names.
export type RuntimePlatform = 'windows' | 'linux' | 'macos';

// This type makes line-ending intent explicit in parser and file-write code.
export type LineEnding = 'lf' | 'crlf';

// This type describes how to launch a shell without leaking OS-specific details.
export type ShellSpawnPlan = {
  platform: RuntimePlatform;
  executable: string;
  args: string[];
  commandFlag: '-Command' | '-c';
  preferredLineEnding: LineEnding;
  pathSeparator: '\\' | '/';
};

// This type configures how static text should be split into lines.
export type SplitLinesOptions = {
  preserveEmptyLines?: boolean;
  trimTrailingEmptyLine?: boolean;
};

// This type configures how streaming stdout and stderr chunks should be accumulated.
export type StreamLineAccumulatorOptions = {
  preserveEmptyLines?: boolean;
};

// This type is the public contract for incremental line parsing from process streams.
export type StreamLineAccumulator = {
  push: (chunk: Buffer | string) => string[];
  flush: () => string[];
  peek: () => string;
  reset: () => void;
};
