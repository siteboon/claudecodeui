import type { spawn } from 'node:child_process';

export type BrowserUseRuntime = 'cloud' | 'local';
export type BrowserUseBackend = 'playwright' | 'camoufox-vnc';
export type BrowserUseSessionStatus = 'ready' | 'stopped' | 'unavailable';

export type BrowserUseSession = {
  id: string;
  ownerId: string;
  createdBy: 'agent';
  runtime: BrowserUseRuntime;
  status: BrowserUseSessionStatus;
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  backend: BrowserUseBackend;
  viewerUrl: string | null;
  viewerEmbedUrl: string | null;
  profileName: string | null;
  viewport: {
    width: number;
    height: number;
  } | null;
  cursor: {
    x: number;
    y: number;
    actor: 'agent';
  } | null;
};

export type PublicBrowserUseSession = Omit<BrowserUseSession, 'ownerId'>;

export type RuntimeHandle = {
  browser?: any;
  context?: any;
  page?: any;
  processes?: Array<ReturnType<typeof spawn>>;
  viewer?: {
    display: string;
    vncPort: number;
    websockifyPort: number;
    noVncRoot: string;
  };
};

export type BrowserUseSettings = {
  enabled: boolean;
  persistSessions: boolean;
  defaultProfileName: string;
  browserBackend: BrowserUseBackend;
};

export type RuntimeReadiness = {
  playwright: any | null;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  chromiumExecutablePath: string | null;
  installInProgress: boolean;
  installMessage: string | null;
};

export type RuntimeProbe = Omit<RuntimeReadiness, 'installInProgress' | 'installMessage'>;
