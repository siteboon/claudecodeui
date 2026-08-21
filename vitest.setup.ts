import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Auto-cleanup only self-registers when vitest globals are enabled, and they are
// not. Without this, a hook rendered in one test stays mounted — with its timers
// and effects live — for the rest of the file.
afterEach(cleanup);
