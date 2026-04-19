Summary: Reworked local bridge ownership around a single preferred endpoint, added explicit takeover/reconnect recovery on the server side, and upgraded the plugin UI into a compact status panel with persistent retry and recovery actions.
Files Modified:
- figma-desktop-bridge/code.js
- figma-desktop-bridge/ui-full.html
- figma-desktop-bridge/ui.html
- src/core/port-discovery.ts
- src/core/websocket-server.ts
- src/local.ts

Functions/Components Changed:
- `advertisePort` / `getAdvertisedOwner` / `terminateAdvertisedOwner`: Added owner lease/version metadata and explicit preferred-port takeover support.
- `FigmaWebSocketServer`: Added ownership-aware server hello metadata, connection snapshots, plugin version/state tracking, and plugin recovery request helpers.
- `LocalFigmaConsoleMCP.startPreferredWebSocketServer`: Starts only the preferred local owner instead of spawning fallback bridge instances.
- `LocalFigmaConsoleMCP.figma_get_status` / `figma_reconnect`: Report richer ownership/heartbeat state and perform real recovery/takeover steps.
- `Figma Desktop Bridge UI`: Switched from multi-port fanout to preferred-port retry, added reconnect/rescan/reload/takeover actions, and surfaced compact connection diagnostics.

Breaking Changes:
- Local mode no longer treats multi-port multi-owner bridge instances as the normal startup behavior.
- New MCP sessions now prefer reporting an active owner on the preferred port instead of auto-binding a fallback local bridge port.

Summary: Added orphan-owner detection and reclaim logic for preferred-port startup/reconnect so sessions can recover from missing lease files and stale migration states.
Files Modified:
- src/core/port-discovery.ts
- src/local.ts

Functions/Components Changed:
- `getListeningProcessInfo` / `terminatePortListeners` / `cleanupLegacyPortFile`: Added lower-level preferred-port process inspection and cleanup helpers.
- `LocalFigmaConsoleMCP.inspectPreferredPortOwner`: Distinguishes advertised owners from orphaned-but-healthy bridge listeners and unknown occupiers.
- `LocalFigmaConsoleMCP.startPreferredWebSocketServer` / `takeoverPreferredOwner`: Reclaims unhealthy orphaned MCP listeners and lets reconnect take over orphaned preferred-port owners.

Breaking Changes:
- Preferred-port reconnect/startup now treats healthy listeners without lease files as orphaned MCP owners and may reclaim them during explicit reconnect.

Summary: Added a long-lived local bridge daemon with Unix-socket IPC, exposed daemon lifecycle commands, and updated local mode to use the daemon as the single WebSocket owner instead of per-session port ownership.
Files Modified:
- README.md
- docs/setup.md
- src/bridge-daemon.ts
- src/core/bridge-controller.ts
- src/core/daemon-bridge-client.ts
- src/core/daemon-bridge-server.ts
- src/core/daemon-paths.ts
- src/core/daemon-protocol.ts
- src/core/websocket-connector.ts
- src/local.ts
- tsconfig.local.json

Functions/Components Changed:
- `DaemonBridgeServer`: Owns the long-lived WebSocket bridge on port 9223 and exposes bridge control/state over a local Unix socket.
- `DaemonBridgeClient`: Gives short-lived MCP sessions a bridge-shaped client that talks to the daemon and can auto-kickstart it.
- `runDaemonCommand` / launchd helpers in `src/local.ts`: Added `install-daemon`, `daemon-status`, `daemon-restart`, and `daemon-uninstall`.
- `LocalFigmaConsoleMCP.start` / `getDesktopConnector` / bridge-aware tools: Switched local mode from direct bridge ownership to daemon-backed status and command routing.
- `WebSocketConnector`: Now depends on a bridge controller interface instead of the concrete in-process WebSocket server.

Breaking Changes:
- Local bridge ownership now assumes a single persistent daemon on macOS instead of one WebSocket owner per MCP session.
- Bridge-dependent local commands now rely on `~/.figma-console-mcp/bridge.sock` and launchd-managed daemon startup.
