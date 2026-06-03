# Hermes for Pebble

Voice assistant for a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent). Speak on your Pebble; the phone sends an OpenAI-compatible request to Hermes; the reply scrolls on the watch.

## Requirements

- Pebble with microphone: Time, Time Steel, Time Round, Pebble 2, **Pebble Time 2** (`emery`)
- Pebble mobile app (Core Devices / Rebble)
- Hermes server with API enabled (`API_SERVER_ENABLED=true`, default port 8642)

## Install

1. Download **`hermes-for-pebble.pbw`** from [Releases](https://github.com/Emilien-Etadam/hermes-for-pebble/releases).
2. Open the file in the Pebble app on your phone to install on the watch.

Or build from source:

```bash
pebble build
# Output: build/hermes-for-pebble.pbw
```

## Settings (phone)

In the Pebble app → **Settings** for *Hermes for Pebble*:

| Field | Description |
|-------|-------------|
| **Server** | e.g. `192.168.1.10:8642` |
| **API key** | Your Hermes `API_SERVER_KEY` |
| **Model** | e.g. `hermes` or `hermes-agent` |
| **Session** | Stable id for Hermes memory (`X-Hermes-Session-Key`), e.g. `pebble:you` |
| **Fast replies** | Short watch answers (45 s timeout). On the Hermes server, set `agent.reasoning_effort: none` and a low `agent.max_turns` (e.g. 5) in `config.yaml` for best results. |
| **Vibration alerts** | Buzz when a reply is ready or when an error occurs |
| **Local history** | Save recent exchanges on the phone (per Session key) |
| **History size** | How many exchanges to keep (5, 10, or 20) |

Tap **Test connection**, then **Save**. Settings stay on the phone; they are not stored on the watch.

## On the watch

1. Open **Hermes for Pebble**.
2. Press **SELECT** → speak → confirm transcription.
3. Read the reply in the main area; **Up/Down** to scroll.
4. **BACK (long press)** → browse previous exchanges; **Up/Down** to pick one; **SELECT** to read that reply; **BACK** to exit browse mode.

## Architecture

```
Watch (C)                     Phone (PebbleKit JS)
────────                      ────────────────────
dictation → PROMPT    ──────► POST /v1/chat/completions
◄──────── REPLY_CHUNK (×N)    reply split into UTF-8 chunks
◄──────── REPLY_DONE          end of transfer
◄──────── STATUS              status / errors

BACK long → HIST_OPEN ──────► read localStorage history
◄──────── HIST_COUNT          number of saved exchanges
◄──────── HIST_LABELS         menu titles (prompt preview)
SELECT → HIST_GET     ──────► load one exchange’s reply (same chunk pipeline)
```

## Hermes server tuning (recommended)

Simple messages like « bonjour » can take minutes if the agent runs with full tools and many turns. In `~/.hermes/config.yaml`:

```yaml
agent:
  reasoning_effort: none
  max_turns: 5
```

Restart the gateway after editing. The Pebble app’s **Fast replies** mode adds a short system prompt and a 45 s client timeout, but the server config above is what makes Hermes respond quickly.

## Development

```bash
npm install
pebble build
pebble install --phone <IP> --logs
```

Platforms: `basalt`, `chalk`, `diorite`, `emery`.

## License

Open source — see the repository for details.
