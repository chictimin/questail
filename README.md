<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <img src="assets/logo-light.png" alt="QuestTail logo — black Yorkshire Terrier-like dog face silhouette" width="180">
  </picture>
</p>

# QuestTail

> English · [한국어](./README.ko.md)

> A local web app that archives your Steam library on your own computer and lets you rate the games.

**Current phase: R1.5** (`v0.5.0-r1.5`, prerelease) — home, recap, and TBTI (gamer type) screens on top of the R1 library archive (ratings, hidden games, Markdown export).

## Prerequisites

- Node.js >= 22.13 (22 LTS or 24 LTS recommended)
  - On Node 25+, run `npm install -g corepack` first (Node 25 no longer bundles corepack).
  - No git needed. No separate pnpm install needed — pnpm comes through corepack, pinned to the exact version by the repo's `packageManager` field.
- A Steam account that owns at least one game, plus a Steam Web API key
  - Issue a key on the [Steam API key page](https://steamcommunity.com/dev/apikey). Enter `localhost` in the domain name field, then agree to the [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms) and register.
  - If the page blocks issuance ("limited user account" notice), the account cannot receive a key yet. See the [Steam support page](https://help.steampowered.com/en/faqs/view/71D3-35C2-AD96-AA3A).

## Quick Start

Open [the releases page](https://github.com/chictimin/questail/releases), download **Source code (zip)** from the newest release at the top, unzip it, and open a terminal in the unzipped folder. Then:

<!-- ci:run -->
```bash
corepack pnpm install && corepack pnpm start
```

After startup, open `http://127.0.0.1:4747` in a browser. The root address `/` redirects home when a Steam account is already connected, and to the connect screen otherwise. On the connect screen, enter the API key and a profile address or SteamID.

> `corepack enable` is optional — it only adds `pnpm` shims to your PATH so you can type `pnpm` instead of `corepack pnpm`.
>
> On rare platforms without a prebuilt database binary, the install stops at `better-sqlite3`: run `pnpm approve-builds`, install the OS build tools (Xcode Command Line Tools on macOS, Visual Studio C++ workload + Python on Windows, Python + make + GCC on Linux), and install again.

### Updating

Recommended: keep data outside the app folder. Set `QUESTAIL_DATA_DIR` to a folder outside the release folders once — every version then uses that folder as is, and updating needs no data move. (The default location stays `data/<steamid64>/` under the app folder.)

Otherwise, to move to a new version: stop the app, copy `data/<steamid64>/` from the old folder into the new folder's `data/`, and start the new version.

### Developer alternative (git)

```bash
git clone https://github.com/chictimin/questail.git
cd questail
corepack pnpm install && corepack pnpm start
```

## Collection Scope

- Each collection fetches owned games, playtime, wishlist, game info, and SteamSpy tags. Achievements are fetched only when enabled (off by default; a disabled row shows as off in collection status). Decide with the checkbox on the connect screen before the first collection; it can be changed later in settings.
- Game info is fetched in the display language only. Check the language in settings before the first collection. With Korean selected, Korean release-date text (`YYYY년 M월 D일`) and genre names are parsed; on update, a migration fills the release date of existing games from that text automatically (after an automatic backup).
- The collection status screen shows per-source state with retry and collect-all. The header shows game info progress while collecting and the last collection date afterward.
- Game info requests go out every 2 seconds, so 1,000 games take about 33 minutes. Larger libraries take hours, longer if Steam rate-limits requests (429).
- A daily snapshot runs at 04:00 in the operating system's local time zone, only while the server is on. A missed run fires once at the next startup.

## R1.5: Home, Recap, TBTI

- Home shows total playtime with a one-line reading (nonstop days, played of owned), the top 5 games, the played share of owned games with the median hours per game, the mean rating, the top two genres, and the TBTI card with a link to details.
- Recap summarizes the whole library in 7 sections, each with a title and a one-line reading: the TBTI card on top, then playtime with the top 5 share, genre bars with shares, played of owned with playtime buckets (`<2h`, `2–10`, `10–30`, `30–100`, `100+`), the median, unplayed games and games that left the library, the rating mean and distribution with high/low deviants, release eras (new/recent/classic), and a release-year timeline with its peaks. An observation band on top shows the observed days and date range (the first collection is the baseline; on the first collection day it says so instead).
- All times follow Steam server records. The screens state their blind spots instead of hiding them: observation days, hidden-game exclusion, missing off-Steam history, unconfirmed genres or release dates, and unreflected achievements.
- TBTI judges four axes from your own history, one line each:
  - Axis 1 Play drive — Immersion (I) vs Run (R), from user tags.
  - Axis 2 Taste source — New (N) vs Home (H), from when you played relative to release.
  - Axis 3 Genre range — One-trick (O) vs All-rounder (A), from genre spread.
  - Axis 4 Depth — Completionist (C) vs Light taster (L), from hours and achievements. When only some games have achievements, the axis shows how many were reflected (`n/m`).
- Each axis shows a two-ended bar, a one-line reading, and why: a metric line, the top contributing games with reason, metric, and axis tags, plus a public reference where one exists. Under 5 hours of total playtime, TBTI stays undecided (`????`) with a progress bar; an undecided axis shows `?` with a one-line reason (too few games, or confirmed time that cannot yet tell New from Home).
- Wishlist toggle (settings, on by default): pre-release wishlist entries count as new-game evidence on axis 2. Turning it off drops that evidence and marks the screen accordingly.
- Series aliases live in `series-aliases.json` directly under the data folder. Keys are normalized game names: lowercase, edition tails (`Remastered`, `Definitive Edition`, and the like) removed, multi-letter Roman numerals up to X as Arabic numerals (e.g. `Dark Souls III` → `dark souls 3`, `Dark Souls: Remastered` → `dark souls`; single letters such as `X` stay). Each game is looked up by its full normalized name first, then by its core — the part before the first separator (`:`, ` - `, and the like; e.g. `monster hunter: world` → `monster hunter`). Both are exact matches. Games without an alias group by their core.

  ```
  { "aliases": { "monster hunter": "monster-hunter", "monster hunter wilds": "monster-hunter" } }
  ```

  A missing file falls back to built-in defaults; a broken file (bad JSON or wrong shape) means no aliases, and the TBTI screen says so.
- Recap and TBTI can be taken as text: copy buttons on screen, the TBTI share sheet (optionally with recap, no account info included), and Markdown export to `recap.md`. The text follows the language shown on screen.
- Numbers on screen and in text are whole numbers (hours, percentages, counts). Star ratings keep half steps (★3, ★3.5); averages and deviations are rounded to the nearest half star. Judgments use the unrounded values.
- In English, TBTI codes, axes, metrics, and readings are shown in English; the card text (nickname, definition, body) exists in Korean only, so the card body is hidden with a one-line notice. Genre names collected only in Korean are shown in English for common Steam genres, and as "Other genre" otherwise.

## Data Directory

- Default location is `data/<steamid64>/`. The account folder is created under `data/` in the repository root when Steam connection succeeds. Before connecting, there is no account folder.
- Set the `QUESTAIL_DATA_DIR` environment variable and restart the app to use that path as is. No account subfolder is created in this case.
- The legacy single folder `data/questail.db` from earlier versions is still used as is. An empty legacy DB (no linked Steam ID and no game records) is ignored with a warning. However, the app does not start in two cases. If it exists together with an account folder, it shows "legacy data/questail.db and an account folder exist together — move one of them or set QUESTAIL_DATA_DIR"; move one of them, or set the folder to use with `QUESTAIL_DATA_DIR`. If it has no linked Steam ID but holds game records, it shows "legacy data/questail.db has game records that are not linked, so the app does not start — point QUESTAIL_DATA_DIR at that folder or move it manually".
- If the legacy `data/questail.db` cannot be opened, the app also does not start. It shows "cannot read legacy data/questail.db; cannot start — check or move the file".
- If `data/` holds more than one account folder, the app does not start. It shows "more than one account folder — set QUESTAIL_DATA_DIR"; set the one folder to use with `QUESTAIL_DATA_DIR`.
- If the account ID in an account folder's DB differs from the folder name (or cannot be read), the app does not start. It shows "account ID in the account folder DB differs from the folder name — fix or move that folder"; fix or move that folder.
- When the legacy `data/` is used, backups and `steam.key` are located directly under `data/`.
- Only one process may use the same data folder. Keep it on a local disk. Locking is not guaranteed on network or synced folders (for example iCloud, Dropbox, NAS).
- Warning: deleting the repository folder or running `git clean -fdx` deletes `data/` together with it.

## Backup

- Automatic backup: before applying pending schema migrations to an existing database, and when connecting to an existing account folder, the app writes `questail-<UTC time>.db` into `backups/` directly under the data folder. There is no limit on the number of backups. No backup is made for a new, empty database. When the legacy `data/` is used, the folder is `data/backups/`.
- Manual backup: quit the app, then copy the whole data folder (`data/<steamid64>/`, SQLite files).

## Port

- Default port is `4747`. Set the `QUESTAIL_PORT` environment variable to change it. If the port is already in use, startup fails with a message.

## Stopping

- Stop with Ctrl+C.
- For background or service use, build once with `corepack pnpm start`, then run the server directly:

```bash
node apps/web/dist/src/server/run.js
```

`pnpm` does not forward SIGTERM to its child process, so stopping through `pnpm` can leave the server behind.

## Achievements

- Collection is optional. The connect screen has a checkbox (off by default) to decide before the first collection, and settings can change it later.
- Achievement records are collected only when "Game details" on the Steam profile is public. If it is private, those games are skipped. This is an account setting, not an app failure.
- Unrecorded achievements leave the TBTI depth axis playtime-only. The screen says so with the matching action: turn collection on when it is off, fetch achievements only when the profile is private, and no action while collection is still incomplete.

## Key Handling

- The API key is stored only in the `steam.key` file inside the account data folder (`data/<steamid64>/`). If `QUESTAIL_DATA_DIR` is set, it is stored in that folder.
- Do not share the API key. If it leaks, revoke it on the key page, register a new one, and replace it in the app.
- On Windows, key file permission checks (600) do not apply. The permission check is skipped.

## Tests

- `pnpm test` runs unit and browser E2E tests. No real Steam account or API key is needed. Install the E2E browser first (the same command CI uses):

```bash
pnpm --filter @questail/web exec playwright install --with-deps chromium
```

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
│       │   ├── ui/              # React screens (connect, home, recap, tbti, sync, library, export, settings)
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
