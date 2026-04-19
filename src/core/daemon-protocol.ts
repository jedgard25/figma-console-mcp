import type {
  ConnectedFileInfo,
  ConnectionStateSnapshot,
  DocumentChangeEntry,
  SelectionInfo,
} from './websocket-server.js';
import type { ConsoleLogEntry } from './types/index.js';

export type DaemonRequest =
  | { id: string; action: 'health' }
  | { id: string; action: 'get_status' }
  | { id: string; action: 'get_connected_files' }
  | { id: string; action: 'set_active_file'; fileKey: string }
  | { id: string; action: 'send_command'; method: string; params?: Record<string, any>; timeoutMs?: number; targetFileKey?: string }
  | { id: string; action: 'request_plugin_reload' }
  | { id: string; action: 'request_plugin_reconnect'; scanRange?: boolean }
  | { id: string; action: 'get_console_logs'; options?: { count?: number; level?: ConsoleLogEntry['level'] | 'all'; since?: number } }
  | { id: string; action: 'clear_console_logs' }
  | { id: string; action: 'get_document_changes'; options?: { count?: number; since?: number } }
  | { id: string; action: 'clear_document_changes' };

export interface DaemonStatusPayload {
  connectedFileInfo: ConnectedFileInfo | null;
  currentSelection: SelectionInfo | null;
  connectedFiles: (ConnectedFileInfo & { isActive: boolean })[];
  connectionSnapshot: ConnectionStateSnapshot | null;
  consoleStatus: {
    isMonitoring: boolean;
    anyClientConnected: boolean;
    logCount: number;
    bufferSize: number;
    workerCount: number;
    oldestTimestamp?: number;
    newestTimestamp?: number;
  };
  activeFileKey: string | null;
  activeClientLastPongAt: number | null;
  activeClientConnectionState: ConnectionStateSnapshot['connectionState'] | null;
  activeClientPluginVersion: string | null;
  lastDisconnectReason: string | null;
  editorType: 'figma' | 'figjam' | 'dev';
  isClientConnected: boolean;
  address: { port: number; address: string; family: string } | null;
  startedAt: number;
}

export type DaemonResponse =
  | { id: string; ok: true; data: any }
  | { id: string; ok: false; error: string };
