import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { getBackendPort, startBackend, stopBackend } from './backend-manager';

let mainWindow: BrowserWindow | null = null;

const createWindow = async (): Promise<void> => {
  await startBackend();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  } else {
    await mainWindow.loadURL('http://127.0.0.1:3000');
  }
};

app.whenReady().then(async () => {
  ipcMain.handle('slideforge:get-api-base', async () => {
    const port = getBackendPort();
    return `http://127.0.0.1:${port}`;
  });

  ipcMain.handle('slideforge:open-deck-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Decks', extensions: ['pptx', 'pdf'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    return { path: filePath, filename: path.basename(filePath) };
  });

  await createWindow();
});

app.on('window-all-closed', async () => {
  await stopBackend();
  app.quit();
});
