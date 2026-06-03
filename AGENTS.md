# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

Single Pebble watch app (**Hermes for Pebble**): C on the watch (`src/c/`), PebbleKit JS on the phone (`src/pkjs/`), bundled with `pebble-clay` for settings. There is no in-repo backend; a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent) API is required for real chat and for **Test connection** in app settings.

### One-time VM setup (not in the update script)

The Pebble toolchain is **not** installed by `npm install`. On a fresh VM, install once (see [Rebble SDK docs](https://developer.rebble.io/sdk/)):

1. System packages (Ubuntu): `libsdl1.2debian`, `libfdt1`, plus Node if missing.
2. `curl -LsSf https://astral.sh/uv/install.sh | sh` then `uv tool install pebble-tool --python 3.13`.
3. Ensure `export PATH="$HOME/.local/bin:$PATH"` (e.g. in `~/.bashrc`).
4. `pebble sdk install latest` (downloads SDK to `~/.pebble-sdk`; persists across sessions if the VM is snapshotted).

Verify: `pebble --version` should show Pebble Tool v5.x and an active SDK (e.g. 4.9.x).

### Build and run (standard commands)

From repo root:

```bash
npm install
pebble build
# Artifact: build/hermes-for-pebble.pbw
```

**Emulator (no phone/watch):** install the built bundle explicitly (required when not relying on implicit project detection):

```bash
pebble install build/hermes-for-pebble.pbw --emulator basalt
pebble screenshot /tmp/pebble.png
pebble emu-button click select   # opens dictation UI when app is in foreground
```

Avoid `pebble install ... --vnc` on minimal Linux images unless `en-us` QEMU keymaps are installed (`could not read keymap file: 'en-us'`).

**Hardware:** `pebble install --phone <phone_IP> --logs` (phone and watch paired in the Pebble app).

**Settings / PKJS:** `pebble emu-app-config` opens the Clay configuration WebView when an emulator with pypkjs is running.

### Lint / tests

`package.json` has no `lint` or `test` scripts. Validation in Cloud Agents is typically `pebble build` plus optional emulator install/screenshot. Full voice → Hermes → reply flow needs a reachable Hermes server and a phone (or emulator with working PKJS + network).

### Gotchas

- `pebble build` runs `npm install` for the SDK’s JS toolchain as part of the Waf bundle step; repo `npm install` only pulls `pebble-clay`.
- Dictation and microphone behavior on the emulator are limited compared to real hardware.
- Phone must reach the Hermes host (often LAN IP like `192.168.x.x:8642`).
