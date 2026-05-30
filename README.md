# Hermes for Pebble

Client vocal Pebble pour un [Hermes Agent](https://github.com/NousResearch/hermes-agent) auto-hébergé. Dictée sur la montre, requête HTTP OpenAI-compatible côté téléphone, réponse affichée en texte défilant.

## Prérequis

- Montre compatible micro : Pebble Time, Time Steel, Time Round, Pebble 2, **Pebble Time 2** (plateforme `emery`)
- Application mobile Pebble (Core Devices / Rebble)
- Serveur Hermes avec API activée (`API_SERVER_ENABLED=true`, port 8642 par défaut)

## Installation

1. Télécharger **`hermes-for-pebble.pbw`** depuis [Releases](https://github.com/Emilien-Etadam/hermes-for-pebble/releases).
2. Ouvrir le fichier avec l’app Pebble sur le téléphone pour installer sur la montre.

Ou compiler vous-même :

```bash
pebble build
# Artefact : build/hermes-for-pebble.pbw
```

## Configuration (Clay)

Dans l’app Pebble → **Settings** de *Hermes for Pebble* :

| Champ | Description |
|-------|-------------|
| **URL API Hermes** | Ex. `http://192.168.1.10:8642/v1/chat/completions` |
| **Clé (Bearer)** | Valeur de `API_SERVER_KEY` sur le serveur |
| **Session** | Clé stable pour la mémoire Hermes (`X-Hermes-Session-Key`), ex. `pebble:emilien` |
| **Modèle** | Ex. `hermes` |

Les paramètres restent sur le téléphone ; ils ne sont **pas** envoyés à la montre.

## Utilisation

1. Ouvrir **Hermes for Pebble** sur la montre.
2. Appuyer sur **SELECT** → parler → valider la transcription.
3. La réponse s’affiche dans la zone défilante ; **Haut/Bas** pour lire.

## Architecture

```
Montre (C)                    Téléphone (PebbleKit JS)
─────────                     ────────────────────────
dictée → PROMPT    ────────►  POST Hermes /v1/chat/completions
◄──────── REPLY_CHUNK (×N)    réponse découpée en chunks UTF-8 ≤200 o
◄──────── REPLY_DONE          fin de transfert
◄──────── STATUS              erreurs / config manquante
```

## Développement

```bash
npm install          # pebble-clay (via pebble package install)
pebble build
pebble install --phone <IP> --logs
```

Cibles : `basalt`, `chalk`, `diorite`, `emery`.

## Licence

Projet open source — voir le dépôt pour les détails.
