# `packages/core/archive/` — R1 archived modules (D-13)

This directory holds modules that the R1 product no longer uses, kept for
reference instead of deleted:

- `agent/` — deterministic Korean-only tool router + evidence verifier
  (collie port; R1 does not call an LLM).
- `analyze/` — library analysis + report rendering (used only by the old CLI).
- `profile/`, `llm/`, `config/` — taste-profile stub, LLM options, old CLI config.
- `storage/` — Markdown store (`games/*.md`, `library.md`, `history.jsonl`).
- `cli.ts`, `i18n.ts` — the pre-R1 CLI and its CLI-only strings.
- `cache-dir.ts` — `QUESTAIL_CACHE_DIR` env resolution copy for the archived
  CLI only (single copy; the R1 path passes `cacheDir` explicitly).
- `tools/` — `eval/` harness (`dryrun`/`loader`/`score`) and the v0.x
  Markdown-ledger scripts (`migrate-d9`, `rebuild-library`, `recache`).
  The `tools/eval/data` + `docs/` fixtures stay in place at `tools/eval/`.

Status: archived during R1. Whether to reuse any of this for R2 (taste
conversation) is undecided — do not import it from R1 code.

Not executed, not typechecked: `packages/core` tsconfig includes `src`
only, so nothing under `archive/` is built or tested by R1 commands.
The current core pack (the `pack --dry-run` step of `release:check`)
still includes `archive/` in its file list; the distribution unit will
be decided when R1 ends. Runtime path constants inside the archived tools
(`games/…`, `tools/eval/data/…`) still point at their pre-move locations
and do not resolve from here.

To recover the pre-archive state: `git checkout v0.3.0 -- <path>`.
The eval baseline (`26/27, C2-05 only`) is verified from the `v0.3.0`
tag only, never from this directory.
