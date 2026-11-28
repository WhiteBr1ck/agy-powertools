# Agent Multi-Device Usage Sync Guide

For Antigravity, Codex, and other local coding agents. Configures Agy Powertools multi-device usage statistics synchronization using local files only (no chat text is ever exported or synced).

## Prerequisites

1. Verify Agy Powertools is installed at `~/.gemini/config/plugins/agy-powertools/` (or in the current repository).
2. Locate a Node.js >= 22.13 runtime:
   - Use local `node` if >= 22.13, or
   - Windows fallback: `%APPDATA%\Antigravity\bin\agy-node.cmd`
   - macOS fallback: `/Applications/Antigravity.app/Contents/MacOS/Electron` with `ELECTRON_RUN_AS_NODE=1`
   - Linux fallback: `~/.antigravity-hub-server/bin/agy-node` or `agy-node` next to Antigravity.

## Automated Setup Steps

1. Initialize and enable sync via `scripts/sync.mjs`:
   - Shared folder + optional SSH hosts (for headless servers or NAS running `agy` CLI):
     ```sh
     node ~/.gemini/config/plugins/agy-powertools/scripts/sync.mjs init --enable --dir "<SHARED_SYNC_FOLDER>" --ssh "<SSH_HOST>" --json
     ```
   - Omit `--dir` if only SSH collection is needed on this workstation, or omit `--ssh` if this workstation only shares via `syncDir`.
   - Add `--privacy on` to omit error text and hash `conversationId` values in exported snapshots.
   - Add `--name "<DEVICE_NAME>"` if the user specifies a custom label (defaults to OS hostname).
   - Add `--email "<ACCOUNT_EMAIL>"` on headless CLI-only hosts that do not run the Desktop client.
2. Verify the output JSON from `sync.mjs status --json` (or `init --json`):
   - Confirm `status.enabled === true`, `status.deviceId`, `status.deviceName`, `status.peers`, `localRequestCount`, and `totalMergedRequests`.
   - Once synced, **Powertools -> Overview** shows a device filter, a **Usage by device** donut card, and a device column badge in **Requests**.
3. Never force-close Antigravity and never modify other plugins, credentials, or chat history.

## Headless NAS, Custom `.gemini`, and Direct JSON Exporters

- **Shared folder permissions**: if an SMB share is temporarily read-only on a workstation, Powertools still reads remote `device-*.json` files and reports `Sync folder is read-only (peer reading still active)`. Switch the share to Read/Write so every workstation can also publish its own snapshot.
- **Custom CLI data path**: if `agy` CLI lives outside `$HOME/.gemini` (e.g., `/DATA/AppData/antigravity/.gemini` on a NAS), set `HOME=/DATA/AppData/antigravity` or `ANTIGRAVITY_CLI_DATA_DIR=/DATA/AppData/antigravity/.gemini/antigravity-cli`.
- **Hosts without Node.js >= 22.13**: any cron script can write an atomic `device-<id>.json` into the shared folder using format `agy-powertools-usage-sync` v1 (last 90 days, max 20,000 requests, sorted by `timestampMs` desc):
  ```json
  {
    "format": "agy-powertools-usage-sync",
    "schemaVersion": 1,
    "kind": "device",
    "deviceId": "my-nas",
    "deviceName": "My-NAS",
    "privacyMode": false,
    "updatedAtMs": 1795855000000,
    "requests": [
      {
        "id": "<conversationId>-<stepIndex>",
        "conversationId": "<conversationId>",
        "stepIndex": 1,
        "timestampMs": 1795854900000,
        "model": "Gemini 4 Hydrogen (High)",
        "inputTokens": 1000,
        "cacheReadTokens": 9000,
        "outputTokens": 500,
        "cacheHitPercent": 90,
        "tps": 180.5,
        "tpsMode": "stream",
        "status": "success",
        "error": "",
        "retries": 0,
        "retryErrors": [],
        "accountEmail": "user@example.com",
        "deviceId": "my-nas",
        "deviceName": "My-NAS"
      }
    ]
  }
  ```

## Copyable Prompts

### English
> Configure Agy Powertools multi-device usage sync on this machine. First read `~/.gemini/config/plugins/agy-powertools/docs/SYNC_AGENT.md`, then run `scripts/sync.mjs init --enable` with `--dir "<SHARED_FOLDER>"` (and `--ssh "<NAS_HOST>"` if reachable from this PC) using local Node.js or Antigravity `agy-node`. Keep all other plugins, accounts, and chats intact, verify with `sync.mjs status --json`, and show me the detected devices.

### Français
> Configure la synchronisation multi-appareils d'Agy Powertools sur cette machine. Lis d'abord `~/.gemini/config/plugins/agy-powertools/docs/SYNC_AGENT.md`, puis exécute `scripts/sync.mjs init --enable` avec `--dir "<DOSSIER_PARTAGE>"` (et `--ssh "<HOTE_NAS>"` s'il est joignable depuis ce PC) avec Node.js local ou `agy-node` d'Antigravity. Conserve tous les autres plugins, comptes et historiques intacts, vérifie avec `sync.mjs status --json`, et affiche-moi les appareils détectés.
