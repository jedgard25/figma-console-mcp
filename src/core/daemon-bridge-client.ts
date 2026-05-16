import { Socket } from 'net';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import type { BridgeController } from './bridge-controller.js';
import type { DaemonRequest, DaemonResponse, DaemonStatusPayload } from './daemon-protocol.js';
import { DAEMON_LABEL, getDaemonSocketPath } from './daemon-paths.js';
import type { ConsoleLogEntry } from './types/index.js';
import type {
  ConnectedFileInfo,
  ConnectionStateSnapshot,
  DocumentChangeEntry,
  SelectionInfo,
} from './websocket-server.js';
import { createChildLogger } from './logger.js';

const logger = createChildLogger({ component: 'daemon-bridge-client' });

function kickstartDaemon(): void {
  if (process.platform !== 'darwin') return;
  try {
    const uid = process.getuid?.();
    if (uid === undefined) return;
    execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${DAEMON_LABEL}`], {
      stdio: 'ignore',
      timeout: 3000,
    });
  } catch (error) {
    logger.debug({ error }, 'launchctl kickstart failed');
  }
}

export class DaemonBridgeClient implements BridgeController {
  private readonly socketPath = getDaemonSocketPath();
  private started = false;
  private cache: DaemonStatusPayload | null = null;
  private cacheAt = 0;

  isStarted(): boolean {
    return this.started || existsSync(this.socketPath);
  }

  isClientConnected(): boolean {
    return this.cache?.isClientConnected ?? false;
  }

  address(): import('net').AddressInfo | null {
    if (!this.cache?.address) return null;
    return this.cache.address;
  }

  async sendCommand(
    method: string,
    params: Record<string, any> = {},
    timeoutMs = 15000,
    targetFileKey?: string,
  ): Promise<any> {
    return this.request({
      id: randomUUID(),
      action: 'send_command',
      method,
      params,
      timeoutMs,
      targetFileKey,
    });
  }

  getConnectedFileInfo(): ConnectedFileInfo | null {
    return this.cache?.connectedFileInfo ?? null;
  }

  getCurrentSelection(): SelectionInfo | null {
    return this.cache?.currentSelection ?? null;
  }

  getDocumentChanges(): DocumentChangeEntry[] {
    return [];
  }

  clearDocumentChanges(): number {
    return 0;
  }

  getConsoleLogs(): ConsoleLogEntry[] {
    return [];
  }

  clearConsoleLogs(): number {
    return 0;
  }

  getConsoleStatus() {
    return this.cache?.consoleStatus ?? {
      isMonitoring: false,
      anyClientConnected: false,
      logCount: 0,
      bufferSize: 0,
      workerCount: 0,
    };
  }

  getConnectedFiles(): (ConnectedFileInfo & { isActive: boolean })[] {
    return this.cache?.connectedFiles ?? [];
  }

  getActiveClientLastPongAt(): number | null {
    return this.cache?.activeClientLastPongAt ?? null;
  }

  getActiveClientConnectionState(): ConnectionStateSnapshot['connectionState'] | null {
    return this.cache?.activeClientConnectionState ?? null;
  }

  getActiveClientPluginVersion(): string | null {
    return this.cache?.activeClientPluginVersion ?? null;
  }

  getLastDisconnectReason(): string | null {
    return this.cache?.lastDisconnectReason ?? null;
  }

  getConnectionSnapshot(): ConnectionStateSnapshot | null {
    return this.cache?.connectionSnapshot ?? null;
  }

  async requestClientReconnect(scanRange = false): Promise<any> {
    return this.request({
      id: randomUUID(),
      action: 'request_plugin_reconnect',
      scanRange,
    });
  }

  async requestClientReloadUi(): Promise<any> {
    return this.request({
      id: randomUUID(),
      action: 'request_plugin_reload',
    });
  }

  setActiveFile(fileKey: string): boolean {
    if (!this.cache?.connectedFiles.some((file) => file.fileKey === fileKey)) {
      return false;
    }
    void this.request({
      id: randomUUID(),
      action: 'set_active_file',
      fileKey,
    }).catch((error) => {
      logger.warn({ error, fileKey }, 'Failed to switch active file via daemon');
    });
    return true;
  }

  getActiveFileKey(): string | null {
    return this.cache?.activeFileKey ?? null;
  }

  getEditorType(): 'figma' | 'figjam' | 'dev' {
    return this.cache?.editorType ?? 'figma';
  }

  async refreshStatus(force = false): Promise<DaemonStatusPayload | null> {
    if (!force && this.cache && Date.now() - this.cacheAt < 1000) {
      return this.cache;
    }

    try {
      const data = await this.request({
        id: randomUUID(),
        action: 'get_status',
      });
      this.started = true;
      this.cache = data as DaemonStatusPayload;
      this.cacheAt = Date.now();
      return this.cache;
    } catch (error) {
      this.cache = null;
      this.cacheAt = 0;
      logger.debug({ error }, 'Failed to refresh daemon status');
      return null;
    }
  }

  async getRemoteConsoleLogs(options?: {
    count?: number;
    level?: ConsoleLogEntry['level'] | 'all';
    since?: number;
  }): Promise<ConsoleLogEntry[]> {
    return this.request({
      id: randomUUID(),
      action: 'get_console_logs',
      options,
    });
  }

  async clearRemoteConsoleLogs(): Promise<number> {
    return this.request({
      id: randomUUID(),
      action: 'clear_console_logs',
    });
  }

  async getRemoteDocumentChanges(options?: { count?: number; since?: number }): Promise<DocumentChangeEntry[]> {
    return this.request({
      id: randomUUID(),
      action: 'get_document_changes',
      options,
    });
  }

  async clearRemoteDocumentChanges(): Promise<number> {
    return this.request({
      id: randomUUID(),
      action: 'clear_document_changes',
    });
  }

  private async request(request: DaemonRequest): Promise<any> {
    try {
      return await this.requestOnce(request);
    } catch (error) {
      logger.debug({ error }, 'Bridge daemon request failed; kickstarting launchd and retrying once');
      kickstartDaemon();
      return this.requestOnce(request);
    }
  }

  private requestOnce(request: DaemonRequest): Promise<any> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let buffer = '';
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        fn();
      };

      socket.setTimeout(5000);
      socket.on('timeout', () => finish(() => reject(new Error('Timed out waiting for bridge daemon'))));
      socket.on('error', (error) => finish(() => reject(error)));
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) return;

        const raw = buffer.slice(0, newlineIndex);
        const response = JSON.parse(raw) as DaemonResponse;
        finish(() => {
          if (!response.ok) {
            reject(new Error(response.error));
            return;
          }
          resolve(response.data);
        });
      });

      socket.connect(this.socketPath, () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });
    });
  }
}
