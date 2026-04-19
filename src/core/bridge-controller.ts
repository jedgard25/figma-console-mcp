import type {
  ConnectedFileInfo,
  ConnectionStateSnapshot,
  DocumentChangeEntry,
  SelectionInfo,
} from './websocket-server.js';
import type { ConsoleLogEntry } from './types/index.js';

export interface BridgeController {
  isStarted(): boolean;
  isClientConnected(): boolean;
  sendCommand(
    method: string,
    params?: Record<string, any>,
    timeoutMs?: number,
    targetFileKey?: string,
  ): Promise<any>;
  address(): import('net').AddressInfo | null;
  getConnectedFileInfo(): ConnectedFileInfo | null;
  getCurrentSelection(): SelectionInfo | null;
  getDocumentChanges(options?: { count?: number; since?: number }): DocumentChangeEntry[];
  clearDocumentChanges(): number;
  getConsoleLogs(options?: {
    count?: number;
    level?: ConsoleLogEntry['level'] | 'all';
    since?: number;
  }): ConsoleLogEntry[];
  clearConsoleLogs(): number;
  getConsoleStatus(): {
    isMonitoring: boolean;
    anyClientConnected: boolean;
    logCount: number;
    bufferSize: number;
    workerCount: number;
    oldestTimestamp?: number;
    newestTimestamp?: number;
  };
  getConnectedFiles(): (ConnectedFileInfo & { isActive: boolean })[];
  getActiveClientLastPongAt(): number | null;
  getActiveClientConnectionState(): ConnectionStateSnapshot['connectionState'] | null;
  getActiveClientPluginVersion(): string | null;
  getLastDisconnectReason(): string | null;
  getConnectionSnapshot(): ConnectionStateSnapshot | null;
  requestClientReconnect(scanRange?: boolean): Promise<any>;
  requestClientReloadUi(): Promise<any>;
  setActiveFile(fileKey: string): boolean;
  getActiveFileKey(): string | null;
  getEditorType(): 'figma' | 'figjam' | 'dev';
  stop?(): Promise<void>;
}
