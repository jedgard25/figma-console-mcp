#!/usr/bin/env node

import { mkdirSync } from 'fs';
import { DaemonBridgeServer } from './core/daemon-bridge-server.js';
import { getDaemonLogDir, getDaemonSocketPath } from './core/daemon-paths.js';
import { DEFAULT_WS_PORT } from './core/port-discovery.js';
import { createChildLogger } from './core/logger.js';

const logger = createChildLogger({ component: 'bridge-daemon' });

async function main() {
  mkdirSync(getDaemonLogDir(), { recursive: true });
  const server = new DaemonBridgeServer({
    socketPath: getDaemonSocketPath(),
    port: Number(process.env.FIGMA_WS_PORT || DEFAULT_WS_PORT),
    host: process.env.FIGMA_WS_HOST || 'localhost',
  });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
  logger.info({ socketPath: getDaemonSocketPath() }, 'Bridge daemon started');
}

main().catch((error) => {
  logger.error({ error }, 'Bridge daemon crashed');
  process.exit(1);
});
