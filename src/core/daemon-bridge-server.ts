import { createServer, type Socket } from 'net';
import { mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';
import type { AddressInfo } from 'net';
import { FigmaWebSocketServer, SERVER_VERSION } from './websocket-server.js';
import type { DaemonRequest, DaemonResponse, DaemonStatusPayload } from './daemon-protocol.js';
import { createChildLogger } from './logger.js';

const logger = createChildLogger({ component: 'daemon-bridge-server' });

export class DaemonBridgeServer {
  private readonly wsServer: FigmaWebSocketServer;
  private readonly socketPath: string;
  private readonly host: string;
  private readonly port: number;
  private readonly startedAt = Date.now();
  private server = createServer();

  constructor(options: { socketPath: string; port: number; host?: string }) {
    this.socketPath = options.socketPath;
    this.port = options.port;
    this.host = options.host || 'localhost';
    this.wsServer = new FigmaWebSocketServer({
      port: this.port,
      host: this.host,
      preferredPort: this.port,
      ownerLeaseId: `daemon-${process.pid}`,
    });
  }

  async start(): Promise<void> {
    mkdirSync(dirname(this.socketPath), { recursive: true });
    rmSync(this.socketPath, { force: true });
    await this.wsServer.start();

    await new Promise<void>((resolve, reject) => {
      this.server.on('error', reject);
      this.server.on('connection', (socket) => this.handleConnection(socket));
      this.server.listen(this.socketPath, () => resolve());
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    rmSync(this.socketPath, { force: true });
    await this.wsServer.stop();
  }

  private handleConnection(socket: Socket): void {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;

      const raw = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      let response: DaemonResponse;
      try {
        const request = JSON.parse(raw) as DaemonRequest;
        response = { id: request.id, ok: true, data: await this.handleRequest(request) };
      } catch (error) {
        response = {
          id: 'unknown',
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      socket.end(`${JSON.stringify(response)}\n`);
    });
  }

  private async handleRequest(request: DaemonRequest): Promise<any> {
    switch (request.action) {
      case 'health':
        return {
          status: 'ok',
          version: SERVER_VERSION,
          pid: process.pid,
          startedAt: this.startedAt,
        };
      case 'get_status':
        return this.getStatusPayload();
      case 'get_connected_files':
        return this.wsServer.getConnectedFiles();
      case 'set_active_file':
        return this.wsServer.setActiveFile(request.fileKey);
      case 'send_command':
        return this.wsServer.sendCommand(
          request.method,
          request.params || {},
          request.timeoutMs,
          request.targetFileKey,
        );
      case 'request_plugin_reload':
        return this.wsServer.requestClientReloadUi();
      case 'request_plugin_reconnect':
        return this.wsServer.requestClientReconnect(request.scanRange);
      case 'get_console_logs':
        return this.wsServer.getConsoleLogs(request.options);
      case 'clear_console_logs':
        return this.wsServer.clearConsoleLogs();
      case 'get_document_changes':
        return this.wsServer.getDocumentChanges(request.options);
      case 'clear_document_changes':
        return this.wsServer.clearDocumentChanges();
      default:
        throw new Error(`Unsupported daemon action: ${(request as DaemonRequest).action}`);
    }
  }

  private getStatusPayload(): DaemonStatusPayload {
    const address = this.wsServer.address() as AddressInfo | null;
    return {
      connectedFileInfo: this.wsServer.getConnectedFileInfo(),
      currentSelection: this.wsServer.getCurrentSelection(),
      connectedFiles: this.wsServer.getConnectedFiles(),
      connectionSnapshot: this.wsServer.getConnectionSnapshot(),
      consoleStatus: this.wsServer.getConsoleStatus(),
      activeFileKey: this.wsServer.getActiveFileKey(),
      activeClientLastPongAt: this.wsServer.getActiveClientLastPongAt(),
      activeClientConnectionState: this.wsServer.getActiveClientConnectionState(),
      activeClientPluginVersion: this.wsServer.getActiveClientPluginVersion(),
      lastDisconnectReason: this.wsServer.getLastDisconnectReason(),
      editorType: this.wsServer.getEditorType(),
      isClientConnected: this.wsServer.isClientConnected(),
      address: address
        ? { port: address.port, address: address.address, family: address.family }
        : null,
      startedAt: this.startedAt,
    };
  }
}
