# QuestTail

> English · [한국어](./README.ko.md)

> A personal-first tool that gathers game history scattered across platforms (Steam/PSN/Xbox) into Markdown archives and provides personal taste analysis via LLM.

**Current phase: M1** — CLI that exports your Steam library to Markdown files.

## Quick Start

```bash
git clone https://github.com/chictimin/questail.git
cd questail
pnpm install
pnpm build

# Global install (optional)
pnpm link --global
```

## Usage

```bash
# 1. Register API key & SteamID (first time only)
questail sniff

# 2. Gather your Steam library
questail gather steam

# 3. Manage configuration
questail config set language en
questail config get steam-api-key
```

### Detailed Walkthrough

**`questail sniff`** — Interactive setup. Registers your Steam Web API key and SteamID in one go.

- SteamID accepts profile URLs (`https://steamcommunity.com/id/xxx`), vanity names, or numeric SteamID64 (auto-resolved via ResolveVanityURL API)
- Saved to `~/.config/questail/.env` — skipped on subsequent runs
- Prompts whether to proceed with `gather steam` right after setup

**`questail gather steam [<id>] [-o <dir>]`** — Fetches your Steam library.

- Omitting `<id>` uses the steam-id stored in config
- `-o <dir>` output directory (default: `./games/`)

**`questail config`** — Configuration management:

| Command | Description |
|---------|-------------|
| `questail config set <key> <value>` | Save a key-value pair |
| `questail config get <key>` | Retrieve a value (secrets masked) |
| `questail config delete <key>` | Delete a value |

### Configuration Keys

| Key | Description | Example |
|-----|-------------|---------|
| `steam-api-key` | Steam Web API key | `ABCDEF1234567890` |
| `steam-id` | SteamID64 (numeric) | `76561197960287930` |
| `language` | Output language (`ko` / `en`) | `en` |

## Output Example

Each game is written as a Markdown file in `./games/`:

```markdown
---
title: ELDEN RING
game_id: 1245620
platform: steam
source: auto
playtime_minutes: 9840
last_played: 1712345678
---

> Auto-imported from Steam.
```

File naming: `{appId}-{title-slug}.md` (e.g. `1245620-elden-ring.md`)

## Project Structure

```
questail/
├── packages/
│   └── core/                  # @questail/core
│       ├── src/
│       │   ├── connectors/    # Platform adapters (Steam)
│       │   ├── normalize/     # Standard schema transformation
│       │   ├── storage/       # Markdown serialization
│       │   ├── i18n.ts        # Internationalization
│       │   └── cli.ts         # CLI entry point
│       └── package.json
├── pnpm-workspace.yaml
└── package.json
```

## Roadmap

| Phase | Goal |
|-------|------|
| **M1** ✅ | Steam library → Markdown CLI |
| M2 | AI taste analysis report CLI |
| M3 | Rating input + Web demo UI |
| M4+ | PSN/Xbox connectors, manual entries, advanced analytics |

## License

MIT
