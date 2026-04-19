import { homedir } from 'os';
import { join } from 'path';

export const DAEMON_LABEL = 'com.southleft.figma-console-mcp.bridge';

export function getDaemonBaseDir(): string {
  return join(homedir(), '.figma-console-mcp');
}

export function getDaemonSocketPath(): string {
  return join(getDaemonBaseDir(), 'bridge.sock');
}

export function getDaemonLogDir(): string {
  return join(getDaemonBaseDir(), 'logs');
}

export function getDaemonStdoutPath(): string {
  return join(getDaemonLogDir(), 'bridge-daemon.stdout.log');
}

export function getDaemonStderrPath(): string {
  return join(getDaemonLogDir(), 'bridge-daemon.stderr.log');
}

export function getLaunchAgentPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);
}
