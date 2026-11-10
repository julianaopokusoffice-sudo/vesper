export {};

type UpdateStatus = {
  state: 'available' | 'downloading' | 'ready' | 'error' | 'idle';
  percent?: number;
  version?: string;
  message?: string;
};

declare global {
  interface Window {
    vesperDesktop?: {
      isDesktop: true;
      platform: string;
      version: string;
      openExternal: (url: string) => Promise<void>;
      installCli: () => Promise<{ ok: boolean; detail: string; path?: string; onPath?: boolean }>;
      cliStatus: () => Promise<{ installed: boolean; onPath: boolean; path?: string }>;
      revealData: () => Promise<void>;
      updates: {
        check: () => Promise<{
          supported: boolean;
          currentVersion: string;
          latestVersion?: string;
          available?: boolean;
          notes?: string;
          error?: string;
        }>;
        download: () => Promise<{ ok: boolean; error?: string }>;
        install: () => Promise<{ ok: boolean; error?: string }>;
        onStatus: (callback: (status: UpdateStatus) => void) => () => void;
      };
    };
  }
}
