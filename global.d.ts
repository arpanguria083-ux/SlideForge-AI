export {};

declare global {
  interface Window {
    slideforge?: {
      apiBase?: string;
      getApiBase?: () => Promise<string>;
      openDeckDialog?: () => Promise<{ path: string; filename: string } | null>;
      openEvidenceDialog?: () => Promise<Array<{ path: string; filename: string }> | null>;
      revealInFolder?: (targetPath: string) => Promise<void>;
      getLogsPath?: () => Promise<string>;
      platform?: 'win32' | 'darwin' | 'linux';
      appVersion?: string;
    };
  }
}
