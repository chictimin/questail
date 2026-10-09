<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <img src="assets/logo-light.png" alt="QuestTail logo — black Yorkshire Terrier-like dog face silhouette" width="180">
  </picture>
</p>

# QuestTail

> English · [한국어](./README.ko.md)

> A local web app that archives your Steam library on your own computer and lets you rate the games.

**Current phase: R1** — local server (Hono + React + SQLite, single process) with library ratings, hidden games, and Markdown export.

## Prerequisites

- Node.js >= 22.13
- pnpm 10.28.2
- A Steam account that owns at least one game, plus a Steam Web API key
  - Issue a key on the [Steam API key page](https://steamcommunity.com/dev/apikey). Enter `localhost` in the domain name field, then agree to the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms) and register.
  - If the page blocks issuance ("limited user account" notice), the account cannot receive a key yet. See the [Steam support page](https://help.steampowered.com/en/faqs/view/71D3-35C2-AD96-AA3A).

## Quick Start

<!-- ci:run -->
```bash
git clone https://github.com/chictimin/questail.git
cd questail
pnpm install && pnpm start
```

After startup, open `http://127.0.0.1:4747` in a browser. The connect screen appears — enter the API key and a profile address or SteamID.

## Data Directory

- Default: `data/` under the repository root. Set the `QUESTAIL_DATA_DIR` environment variable to store it elsewhere, then restart the app.
- Warning: deleting the repository folder or running `git clean -fdx` deletes `data/` together with it.

## Backup

- Manual backup: quit the app, then copy the whole data folder (SQLite files).

## Port

- Default port is `4747`. Set the `QUESTAIL_PORT` environment variable to change it. If the port is already in use, startup fails with a message.

## Stopping

- Stop with Ctrl+C.
- For background or service use, build once with `pnpm start`, then run the server directly:

```bash
node apps/web/dist/src/server/run.js
```

`pnpm` does not forward SIGTERM to its child process, so stopping through `pnpm` can leave the server behind.

## Achievements

- Achievement records are collected only when "Game details" on the Steam profile is public. If it is private, those games are skipped. This is an account setting, not an app failure.
- If achievements are not recorded, the gamer type (TBTI) result and some titles will be affected later.

## Key Handling

- The API key is stored only in the `steam.key` file inside the data directory.
- Do not share the API key. If it leaks, revoke it on the key page, register a new one, and replace it in the app.
- On Windows, key file permission checks (600) do not apply. The permission check is skipped.

## Notes

- Questail is not affiliated with or endorsed by Valve Corporation. Steam is a trademark of Valve Corporation.

## Shelved v0.3 Features

- The `packages/core` CLI (`sniff`, `gather`, `analyze`, `config`) and the agent layer are shelved in R1. The R1 entry point is `pnpm start`.

## Project Structure

```
questail/
├── apps/
│   └── web/                     # R1 app (Hono server + React UI + SQLite)
│       ├── src/
│       │   ├── server/          # HTTP routes, boot sequence
│       │   ├── ui/              # React screens (connect, sync, library, settings)
│       │   ├── data/            # library, ratings, view state services
│       │   └── db/              # schema, migrations, open/backup/migrate
│       └── test/                # unit, e2e, performance harnesses
├── packages/
│   └── core/                    # shared contracts and evaluation tools
├── pnpm-workspace.yaml
└── package.json
```

## License

MIT

Third-party notices: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
