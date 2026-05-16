import { createServer, type Socket } from 'net';
import { mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';
import type { AddressInfo } from 'net';
import { FigmaWebSocketServer, SERVER_VERSION } from './websocket-server.js';
import type { DaemonRequest, DaemonResponse, DaemonStatusPayload } from './daemon-protocol.js';
import { createChildLogger } from './logger.js';
import {
  advertisePort,
  cleanupOrphanedProcesses,
  cleanupStalePortFiles,
  getPortRange,
  HEARTBEAT_INTERVAL_MS,
  refreshPortAdvertisement,
  terminatePortListeners,
  unadvertisePort,
} from './port-discovery.js';

const logger = createChildLogger({ component: 'daemon-bridge-server' });

export class DaemonBridgeServer {
  private wsServer: FigmaWebSocketServer | null = null;
  private readonly socketPath: string;
  private readonly host: string;
  private readonly preferredPort: number;
  private readonly startedAt = Date.now();
  private server = createServer();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private actualPort: number | null = null;

  constructor(options: { socketPath: string; port: number; host?: string }) {
    this.socketPath = options.socketPath;
    this.preferredPort = options.port;
    this.host = options.host || 'localhost';
  }

  async start(): Promise<void> {
    mkdirSync(dirname(this.socketPath), { recursive: true });
    rmSync(this.socketPath, { force: true });
    await this.startWebSocketServer();

    await new Promise<void>((resolve, reject) => {
      this.server.on('error', reject);
      this.server.on('connection', (socket) => this.handleConnection(socket));
      this.server.listen(this.socketPath, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    rmSync(this.socketPath, { force: true });
    if (this.actualPort !== null) {
      unadvertisePort(this.actualPort);
      this.actualPort = null;
    }
    await this.wsServer?.stop();
    this.wsServer = null;
  }

  private async startWebSocketServer(): Promise<void> {
    cleanupStalePortFiles();
    const terminatedPreferred = terminatePortListeners(this.preferredPort, {
      excludePid: process.pid,
      requireCommandMatch: true,
    });
    if (terminatedPreferred.length > 0) {
      logger.info(
        {
          preferredPort: this.preferredPort,
          terminated: terminatedPreferred.map((info) => ({
            pid: info.pid,
            command: info.command?.slice(0, 120),
          })),
        },
        'Bridge daemon cleared existing MCP listener from preferred WebSocket port',
      );
    }
    cleanupOrphanedProcesses(this.preferredPort);

    const errors: string[] = [];
    for (const port of getPortRange(this.preferredPort)) {
      const server = new FigmaWebSocketServer({
        port,
        host: this.host,
        preferredPort: this.preferredPort,
        ownerLeaseId: `daemon-${process.pid}`,
      });

      try {
        await server.start();
        this.wsServer = server;
        this.actualPort = port;
        advertisePort(port, this.host, {
          serverVersion: SERVER_VERSION,
          leaseId: `daemon-${process.pid}`,
          preferredPort: this.preferredPort,
        });
        this.heartbeatTimer = setInterval(() => {
          if (this.actualPort !== null) refreshPortAdvertisement(this.actualPort);
        }, HEARTBEAT_INTERVAL_MS);
        this.heartbeatTimer.unref?.();
        if (port !== this.preferredPort) {
          logger.warn(
            { preferredPort: this.preferredPort, actualPort: port },
            'Bridge daemon bound to fallback WebSocket port',
          );
        }
        return;
      } catch (error) {
        await server.stop().catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${port}: ${message}`);
      }
    }

    throw new Error(
      `Bridge daemon could not bind any WebSocket port in ${this.preferredPort}-${this.preferredPort + getPortRange(this.preferredPort).length - 1}: ${errors.join('; ')}`,
    );
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
        return this.requireWebSocketServer().getConnectedFiles();
      case 'set_active_file':
        return this.requireWebSocketServer().setActiveFile(request.fileKey);
      case 'send_command':
        return this.requireWebSocketServer().sendCommand(
          request.method,
          request.params || {},
          request.timeoutMs,
          request.targetFileKey,
        );
      case 'request_plugin_reload':
        return this.requireWebSocketServer().requestClientReloadUi();
      case 'request_plugin_reconnect':
        return this.requireWebSocketServer().requestClientReconnect(request.scanRange);
      case 'get_console_logs':
        return this.requireWebSocketServer().getConsoleLogs(request.options);
      case 'clear_console_logs':
        return this.requireWebSocketServer().clearConsoleLogs();
      case 'get_document_changes':
        return this.requireWebSocketServer().getDocumentChanges(request.options);
      case 'clear_document_changes':
        return this.requireWebSocketServer().clearDocumentChanges();
      default:
        throw new Error(`Unsupported daemon action: ${(request as DaemonRequest).action}`);
    }
  }

  private requireWebSocketServer(): FigmaWebSocketServer {
    if (!this.wsServer) throw new Error('Bridge daemon WebSocket server is not started');
    return this.wsServer;
  }

  private getStatusPayload(): DaemonStatusPayload {
    const wsServer = this.requireWebSocketServer();
    const address = wsServer.address() as AddressInfo | null;
    return {
      connectedFileInfo: wsServer.getConnectedFileInfo(),
      currentSelection: wsServer.getCurrentSelection(),
      connectedFiles: wsServer.getConnectedFiles(),
      connectionSnapshot: wsServer.getConnectionSnapshot(),
      consoleStatus: wsServer.getConsoleStatus(),
      activeFileKey: wsServer.getActiveFileKey(),
      activeClientLastPongAt: wsServer.getActiveClientLastPongAt(),
      activeClientConnectionState: wsServer.getActiveClientConnectionState(),
      activeClientPluginVersion: wsServer.getActiveClientPluginVersion(),
      lastDisconnectReason: wsServer.getLastDisconnectReason(),
      editorType: wsServer.getEditorType(),
      isClientConnected: wsServer.isClientConnected(),
      address: address
        ? { port: address.port, address: address.address, family: address.family }
        : null,
      startedAt: this.startedAt,
    };
  }
}
