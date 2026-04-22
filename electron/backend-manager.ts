import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import getPort from 'get-port';
import { app } from 'electron';

let backendProcess: ChildProcess | null = null;
let backendPort = 0;

const waitForHealth = async (url: string, timeoutMs = 30_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend did not become healthy: ${url}`);
};

const backendExecutableName = (): string => {
  if (process.platform === 'win32') return 'SlideForge.exe';
  return 'SlideForge';
};

const backendExecutablePath = (): string => {
  const executable = backendExecutableName();
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', executable);
  }
  return path.join(app.getAppPath(), 'backend', 'dist', 'SlideForge', executable);
};

export const startBackend = async (): Promise<number> => {
  if (backendProcess) return backendPort;

  backendPort = await getPort();
  const exePath = backendExecutablePath();
  const dataDir = path.join(app.getPath('userData'), 'data');

  backendProcess = spawn(exePath, ['--host', '127.0.0.1', '--port', String(backendPort), '--data-dir', dataDir], {
    env: {
      ...process.env,
      MODEL_CACHE_DIR: path.join(app.getPath('userData'), 'models'),
    },
    windowsHide: true,
  });

  await waitForHealth(`http://127.0.0.1:${backendPort}/api/health`);
  return backendPort;
};

export const stopBackend = async (): Promise<void> => {
  if (!backendProcess) return;
  backendProcess.kill('SIGTERM');
  backendProcess = null;
};

export const getBackendPort = (): number => backendPort;
