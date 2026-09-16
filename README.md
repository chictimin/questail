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
- After the Steam setup, an LLM setup step follows: `1. OpenAI / 2. Local OpenAI-compatible (Ollama·LM Studio) / 3. Skip`. Your choice is stored as `QUESTAIL_LLM_BASE_URL` / `QUESTAIL_LLM_API_KEY` / `QUESTAIL_LLM_MODEL` in the same file (questail-namespaced so they don't collide with other tools sharing the global env file). Skipping means quantitative-only reports with no AI analysis.
- Prompts whether to proceed with `gather steam` right after setup

**`questail gather steam [<id>] [-o <dir>]`** — Fetches your Steam library and enriches it.

- Omitting `<id>` uses the steam-id stored in config
- `-o <dir>` output directory (default: `./games/`)
- Game metadata (genres, developers, publishers, release date, cover image) is auto-enriched via Steam appdetails
- Achievement completion rate is fetched per game — requires your Steam profile's "Game details" to be set to Public; otherwise it's silently skipped
- Writes `library.md` (the canonical index of objective data) and appends a playtime snapshot to `history.jsonl` in the output directory
- Re-running is non-destructive: objective fields in `games/*.md` are refreshed while subjective fields (ratings and notes, once added) are preserved

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
| `QUESTAIL_LLM_BASE_URL` | LLM endpoint (set via `sniff`) | `https://api.openai.com/v1` |
| `QUESTAIL_LLM_API_KEY` | LLM API key (optional for localhost) | `sk-...` |
| `QUESTAIL_LLM_MODEL` | LLM model name (set via `sniff`) | `gpt-4o-mini` |

## Output Example

Each game is written as a Markdown file in `./games/`:

```markdown
---
title: ELDEN RING
game_id: 1245620
platform: steam
source: auto
playtime_minutes: 9840
achievement_pct: 62
last_played: 1712345678
image: https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg
genres: [RPG, Souls-like]
developers: [FromSoftware Inc.]
publishers: [FromSoftware Inc., Bandai Namco Entertainment]
release_date: 24 Feb, 2022
---

> Auto-imported from Steam.
```

File naming: `{appId}-{title-slug}.md` (e.g. `1245620-elden-ring.md`)

Enrichment fields (`achievement_pct`, `genres`, `developers`, `publishers`, `release_date`, `image`) appear only when the data is available. Re-running `gather` refreshes these objective fields; subjective fields (`rating`, `note`) are preserved once added.

## Project Structure

```
questail/
├── packages/
│   └── core/                  # @questail/core
│       ├── src/
│       │   ├── config/        # Global LLM settings (QUESTAIL_LLM_*)
│       │   ├── llm/           # LLM adapter (single endpoint + no-LLM fallback)
│       │   ├── connectors/    # Platform adapters (Steam)
│       │   ├── metadata/      # appdetails enrichment (cached)
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
