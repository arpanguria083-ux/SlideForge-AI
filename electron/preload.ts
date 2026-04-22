import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('slideforge', {
  getApiBase: async (): Promise<string> => ipcRenderer.invoke('slideforge:get-api-base'),
  openDeckDialog: async (): Promise<{ path: string; filename: string } | null> =>
    ipcRenderer.invoke('slideforge:open-deck-dialog'),
  platform: process.platform,
  appVersion: process.versions.electron,
});
